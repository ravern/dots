import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_useProviders,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import {
  isVisible,
  renameLabel,
  rowNames,
  type Config,
  type ModelRef,
  type Rename,
  type RenameConfig,
  type VisibleModels,
} from "./rename";
import type { rpcContract } from "./server";

const PICKER_TRIGGER = 'button[aria-label^="Provider, model and reasoning"]';
const PICKER_MENU = "[data-bb-portaled-overlay]";
const CODEX_TAB = '[title="Codex"]';
const EDITABLE = 'input, textarea, [contenteditable="true"], .ProseMirror';
// Our own settings rows show raw "from" labels; never rewrite them.
const OWN_UI = "[data-customize-model-names]";

function isInPicker(el: Element): boolean {
  if (el.closest(PICKER_TRIGGER) !== null) return true;
  const menu = el.closest(PICKER_MENU);
  return menu !== null && menu.querySelector(CODEX_TAB) !== null;
}

// Provider tabs carry the provider id in their logo URL; the active tab is underlined.
const PROVIDER_LOGO = /\/providers\/([^/]+)\/logo/;
const HIDDEN_ATTR = "data-customize-model-names-hidden";

function activeProvider(menu: Element): string | null {
  for (const tab of menu.querySelectorAll("button[title]")) {
    const logo = tab.querySelector<HTMLElement>("[data-provider-logo]");
    if (logo === null || !tab.classList.contains("border-foreground")) continue;
    return PROVIDER_LOGO.exec(logo.dataset.providerLogo ?? "")?.[1] ?? null;
  }
  return null;
}

function setHidden(el: HTMLElement, hidden: boolean) {
  if (hidden === el.hasAttribute(HIDDEN_ATTR)) return;
  el.toggleAttribute(HIDDEN_ATTR, hidden);
  el.style.display = hidden ? "none" : "";
}

/**
 * Hides picker rows the active provider tab's show-only list doesn't match.
 * Never hides the checked (selected) row; typing a search shows everything.
 * Rows are matched by bb's own label (the row's title, not our renamed text)
 * plus the id / full name of the model it shows.
 */
function startHiding(visible: VisibleModels, models: Record<string, ModelRef[]>): () => void {
  const apply = () => {
    for (const menu of document.querySelectorAll(PICKER_MENU)) {
      const provider = activeProvider(menu);
      if (provider === null) continue; // not the main picker (or no tabs)
      const patterns = visible[provider];
      const search = menu.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
      const showAll = patterns === undefined || (search !== null && search.value.trim() !== "");
      for (const row of menu.querySelectorAll<HTMLElement>("button")) {
        const label = row.querySelector(":scope > span.truncate[title]")?.getAttribute("title");
        const check = row.querySelector("[data-icon=Check]");
        if (label != null && check !== null) {
          const selected = check.classList.contains("opacity-100");
          setHidden(row, !showAll && !selected && !isVisible(rowNames(label, models[provider] ?? []), patterns));
        } else if (row.hasAttribute("aria-expanded")) {
          // "More models" (aliases): a submenu trigger (aria-haspopup) on desktop, an inline
          // disclosure (aria-expanded only) in the narrow-screen drawer. Hidden outright
          // under a list; searching still reaches aliases.
          setHidden(row, !showAll);
        }
      }
    }
  };

  const observer = new MutationObserver(apply);
  apply();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener("input", apply, true);

  return () => {
    observer.disconnect();
    document.removeEventListener("input", apply, true);
    for (const el of document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`)) setHidden(el, false);
  };
}

/** Rewrites labels in the live DOM; returns a disposer that restores them. */
function startRewriting(config: RenameConfig): () => void {
  const originals = new Map<Text, string>();

  const visit = (node: Text) => {
    const parent = node.parentElement;
    if (parent === null || node.data.length > 200) return;
    if (parent.closest(EDITABLE) !== null || parent.closest(OWN_UI) !== null) return;
    const source = originals.get(node) ?? node.data;
    const renamed = renameLabel(source, isInPicker(parent), config);
    if (renamed === null || renamed === node.data) return;
    if (!originals.has(node)) originals.set(node, node.data);
    node.data = renamed;
  };

  const scan = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return visit(root as Text);
    if (!(root instanceof Element)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) visit(n as Text);
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") {
        // bb re-rendered this text; forget our stale original.
        originals.delete(m.target as Text);
        scan(m.target);
      }
      for (const added of m.addedNodes) scan(added);
      // A picker menu opening makes labels already inside it picker-scoped.
      if (m.target instanceof Element) {
        const menu = m.target.closest(PICKER_MENU);
        if (menu !== null) scan(menu);
      }
    }
    observer.takeRecords(); // drop records caused by our own writes
  });

  scan(document.body);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  return () => {
    observer.disconnect();
    for (const [node, text] of originals) if (node.isConnected) node.data = text;
    originals.clear();
  };
}

function useConfig() {
  const rpc = useRpc<typeof rpcContract>();
  const [config, setConfig] = useState<Config | null>(null);
  const refresh = useCallback(() => {
    rpc.call("getConfig").then(setConfig, () => {});
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime("config", refresh);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection === "connected") refresh();
  }, [connection, refresh]);
  const save = useCallback(
    async (next: Partial<Config>) => setConfig(await rpc.call("setConfig", next)),
    [rpc],
  );
  return { config, save };
}

/** Model ids and full names per listed provider, for matching picker rows. */
function useModels(visible: VisibleModels | undefined) {
  const sdk = useSdk();
  const [models, setModels] = useState<Record<string, ModelRef[]> | null>(null);
  const key = JSON.stringify(Object.keys(visible ?? {}).sort());
  useEffect(() => {
    if (visible === undefined) return;
    let live = true;
    const ids = Object.keys(visible);
    Promise.all(
      ids.map((providerId) =>
        sdk.providers.models({ providerId }).then(
          (r) => r.models.map((m) => ({ id: m.id, displayName: m.displayName })),
          () => [], // label-only matching if the list can't load
        ),
      ),
    ).then((lists) => {
      if (live) setModels(Object.fromEntries(ids.map((id, i) => [id, lists[i]])));
    });
    return () => {
      live = false;
    };
  }, [sdk, key]);
  return models;
}

function Rewriter() {
  const { config } = useConfig();
  const models = useModels(config?.visibleModels);
  useEffect(() => (config === null ? undefined : startRewriting(config)), [config]);
  useEffect(
    () => (config === null || models === null ? undefined : startHiding(config.visibleModels, models)),
    [config, models],
  );
  return null;
}

const inputStyle = {
  flex: 1,
  minWidth: 0,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--input)",
  background: "transparent",
  color: "var(--foreground)",
  font: "inherit",
} as const;

const buttonStyle = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--secondary)",
  color: "var(--foreground)",
  font: "inherit",
  cursor: "pointer",
} as const;

function RenamesSettings() {
  const { config, save } = useConfig();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (config === null) return <p style={{ color: "var(--muted-foreground)" }}>Loading…</p>;

  const run = (next: Partial<RenameConfig>) => {
    setError(null);
    save(next).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const add = () => {
    const f = from.trim();
    if (f === "") return;
    const entry: Rename = { from: f, to: to.trim() };
    run({ renames: [...config.renames.filter((r) => r.from !== f), entry] });
    setFrom("");
    setTo("");
  };

  return (
    <div data-customize-model-names="" style={{ display: "grid", gap: 8, fontSize: 13 }}>
      <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
        Each entry shows a label exactly as bb displays it ("from") as something else ("to").
        Custom entries win over the GPT rule. Display only; model ids are unchanged.
      </p>
      {config.renames.length === 0 ? (
        <p style={{ margin: 0, color: "var(--subtle-foreground)" }}>No custom renames yet.</p>
      ) : (
        config.renames.map((r) => (
          <div key={r.from} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1 }}>{r.from}</code>
            <span aria-hidden>→</span>
            <code style={{ flex: 1 }}>{r.to === "" ? "(hidden)" : r.to}</code>
            <button
              type="button"
              style={buttonStyle}
              aria-label={`Remove rename for ${r.from}`}
              onClick={() => run({ renames: config.renames.filter((x) => x.from !== r.from) })}
            >
              Remove
            </button>
          </div>
        ))
      )}
      <form
        style={{ display: "flex", gap: 8, alignItems: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          style={inputStyle}
          aria-label="From label"
          placeholder='From, e.g. "6-Astra"'
          value={from}
          maxLength={200}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span aria-hidden>→</span>
        <input
          style={inputStyle}
          aria-label="To label"
          placeholder='To, e.g. "Astra"'
          value={to}
          maxLength={200}
          onChange={(e) => setTo(e.target.value)}
        />
        <button type="submit" style={buttonStyle} disabled={from.trim() === ""}>
          Add
        </button>
      </form>
      {error === null ? null : (
        <p role="alert" style={{ margin: 0, color: "var(--destructive-text)" }}>{error}</p>
      )}
    </div>
  );
}

function VisibleModelsSettings() {
  const { config, save } = useConfig();
  const { providers } = experimental_useProviders();
  const [provider, setProvider] = useState("");
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (config === null) return <p style={{ color: "var(--muted-foreground)" }}>Loading…</p>;

  const visible = config.visibleModels;
  const run = (next: VisibleModels) => {
    setError(null);
    save({ visibleModels: next }).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const remove = (p: string, pat: string) => {
    const kept = (visible[p] ?? []).filter((x) => x !== pat);
    const next = { ...visible };
    if (kept.length === 0) delete next[p];
    else next[p] = kept;
    run(next);
  };
  const chosen = provider || providers[0]?.id || "";
  const add = () => {
    const pat = pattern.trim();
    if (chosen === "" || pat === "") return;
    run({ ...visible, [chosen]: [...(visible[chosen] ?? []).filter((x) => x !== pat), pat] });
    setPattern("");
  };
  const name = (id: string) => providers.find((p) => p.id === id)?.displayName ?? id;

  return (
    <div data-customize-model-names="" style={{ display: "grid", gap: 8, fontSize: 13 }}>
      <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
        The model picker shows only models matching a provider's list: bb's own label or the model
        id, case-insensitive, trailing * for any suffix. Providers without a list show everything.
        The selected model and search results always show. Display only.
      </p>
      {Object.keys(visible).length === 0 ? (
        <p style={{ margin: 0, color: "var(--subtle-foreground)" }}>No lists; every model shows.</p>
      ) : (
        Object.entries(visible).flatMap(([p, patterns]) =>
          patterns.map((pat) => (
            <div key={`${p}\0${pat}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1 }}>{name(p)}</span>
              <code style={{ flex: 1 }}>{pat}</code>
              <button
                type="button"
                style={buttonStyle}
                aria-label={`Remove ${pat} from ${name(p)}`}
                onClick={() => remove(p, pat)}
              >
                Remove
              </button>
            </div>
          )),
        )
      )}
      <form
        style={{ display: "flex", gap: 8, alignItems: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <select
          style={inputStyle}
          aria-label="Provider"
          value={chosen}
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <input
          style={inputStyle}
          aria-label="Model label or id"
          placeholder='e.g. "Opus 5.5" or "GPT-6*"'
          value={pattern}
          maxLength={200}
          onChange={(e) => setPattern(e.target.value)}
        />
        <button type="submit" style={buttonStyle} disabled={pattern.trim() === "" || chosen === ""}>
          Add
        </button>
      </form>
      {error === null ? null : (
        <p role="alert" style={{ margin: 0, color: "var(--destructive-text)" }}>{error}</p>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "rewriter", component: Rewriter });
  app.slots.settingsSection({
    id: "renames",
    title: "Renames",
    description: "Add or remove model name renames.",
    component: RenamesSettings,
  });
  app.slots.settingsSection({
    id: "visible-models",
    title: "Visible models",
    description: "Show only these models in the model picker, per provider.",
    component: VisibleModelsSettings,
  });
});
