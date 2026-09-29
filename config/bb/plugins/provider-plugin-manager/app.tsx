import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to bb's toaster
import type { Action, Listing } from "./cli.ts";
import type { ActResult, Machine, rpcContract, State } from "./server.ts";

const PANEL = "provider-plugins";
const button =
  "inline-flex h-7 items-center rounded-md border border-border px-2 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
const danger = `${button} text-destructive`;
const input = "h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Provider = { id: string; displayName: string; logoUrl: string | null; icon?: { glyph: string } };

function ErrorText({ children }: { children: ReactNode }) {
  return <pre className="whitespace-pre-wrap break-words rounded-md bg-destructive/10 p-2 text-xs text-destructive">{children}</pre>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** A button that asks "Sure?" inline before running. */
function Confirm({ label, question, disabled, onConfirm }: { label: string; question: string; disabled: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className={danger} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {question}
      <button className={danger} onClick={() => (setAsking(false), onConfirm())}>
        Yes
      </button>
      <button className={button} onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  );
}

function Browse({ rpc, providerId, hostId, busy, act }: { rpc: Rpc; providerId: string; hostId: string; busy: boolean; act: (a: Action) => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ items: Listing[]; total: number; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const search = () => {
    setLoading(true);
    rpc
      .call("available", { providerId, hostId, query })
      .then(setResult, (e: Error) => setResult({ items: [], total: 0, error: e.message }))
      .finally(() => setLoading(false));
  };
  return (
    <Section title="Browse marketplaces">
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), search())}>
        <input className={input} placeholder="Search plugins (empty lists all)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={button} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {result?.error ? <ErrorText>{result.error}</ErrorText> : null}
      {result && !result.error ? (
        <div className="text-xs text-muted-foreground">
          {result.total} match{result.total === 1 ? "" : "es"}
          {result.total > result.items.length ? `, showing ${result.items.length}` : ""}
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {result?.items.map((p) => (
          <li key={p.id} className="flex items-start gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                {p.name} <span className="text-xs text-muted-foreground">{p.source}</span>
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">{p.description}</div>
            </div>
            {p.installed ? (
              <span className="text-xs text-muted-foreground">Installed</span>
            ) : (
              <button className={button} disabled={busy} onClick={() => act({ kind: "install", id: p.id })}>
                Install
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AgentPanel({ provider, hostId }: { provider: Provider; hostId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [market, setMarket] = useState("");
  const target = { providerId: provider.id, hostId };

  const load = useCallback(() => {
    setLoadError(null);
    rpc.call("state", { providerId: provider.id, hostId }).then(setState, (e: Error) => setLoadError(e.message));
  }, [rpc, provider.id, hostId]);
  useEffect(load, [load]);

  const act = (action: Action, done?: () => void) => {
    setBusy(true);
    setActError(null);
    rpc
      .call("act", { ...target, action })
      .then((r: ActResult) => {
        if (!r.ok) return setActError(r.output);
        done?.();
        toast(`Done. Applies to new ${provider.displayName} threads.`);
      }, (e: Error) => setActError(e.message))
      .finally(() => {
        setBusy(false);
        load();
      });
  };

  const restart = () => {
    setBusy(true);
    rpc
      .call("restartIdle", target)
      .then(({ stopped, busy: running }: { stopped: number; busy: number }) => {
        const rest = running ? ` ${running} busy thread${running === 1 ? "" : "s"} left alone.` : "";
        toast(`Restarted ${stopped} idle ${provider.displayName} thread${stopped === 1 ? "" : "s"}; each resumes on its next message.${rest}`);
      }, (e: Error) => toast(e.message))
      .finally(() => setBusy(false));
  };

  if (loadError) return <ErrorText>{loadError}</ErrorText>;
  if (state === null) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (state.agent === null) {
    return <div className="text-sm text-muted-foreground">Plugin management isn't supported for {provider.displayName} yet.</div>;
  }
  if (state.missing) {
    return (
      <div className="space-y-1 opacity-60">
        <div className="text-sm">
          <code>{state.bin}</code> isn't installed on this machine.
        </div>
        <div className="text-xs text-muted-foreground">Install the {provider.displayName} CLI there (or pick another machine), then reopen this tab.</div>
      </div>
    );
  }
  const { features: f } = state;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs text-muted-foreground">
        <span className="flex-1">
          <code>{state.bin}</code> {state.version}. Changes apply to new threads.
        </span>
        <button className={button} disabled={busy} onClick={restart} title="Stops only idle threads; they resume on their next message">
          Restart idle {provider.displayName} threads
        </button>
      </div>
      {state.note ? <div className="text-xs text-muted-foreground">{state.note}</div> : null}
      {state.errors.map((e) => (
        <ErrorText key={e}>{e}</ErrorText>
      ))}
      {actError ? <ErrorText>{actError}</ErrorText> : null}

      {f.plugins && state.plugins ? (
        <Section title="Installed plugins">
          {state.plugins.length === 0 ? <div className="text-xs text-muted-foreground">None.</div> : null}
          <ul className="divide-y divide-border">
            {state.plugins.map((p) => (
              <li key={`${p.id}:${p.scope}:${p.note}`} className="flex flex-wrap items-center gap-2 py-2">
                <div className={`min-w-0 flex-1 ${p.enabled === false ? "opacity-60" : ""}`}>
                  <div className="text-sm">
                    {p.name} {p.source ? <span className="text-xs text-muted-foreground">{p.source}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[p.version, p.enabled === null ? null : p.enabled ? "enabled" : "disabled", p.note].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {p.actionable ? (
                  <>
                    {f.toggle && p.enabled !== null ? (
                      <button className={button} disabled={busy} onClick={() => act({ kind: p.enabled ? "disable" : "enable", id: p.id })}>
                        {p.enabled ? "Disable" : "Enable"}
                      </button>
                    ) : null}
                    {f.update ? (
                      <button className={button} disabled={busy} onClick={() => act({ kind: "update", id: p.id })}>
                        Update
                      </button>
                    ) : null}
                    {f.uninstall ? (
                      <Confirm label="Uninstall" question={`Uninstall ${p.name}?`} disabled={busy} onConfirm={() => act({ kind: "uninstall", id: p.id })} />
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {f.installSource ? (
        <Section title="Install from source">
          <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
            <input className={input} placeholder="owner/repo, owner/repo#path/to/plugin, or a git URL" value={source} onChange={(e) => setSource(e.target.value)} />
            <Confirm
              label="Install"
              question="Trust and install this plugin's code?"
              disabled={busy || source.trim() === ""}
              onConfirm={() => act({ kind: "install", id: source.trim() }, () => setSource(""))}
            />
          </form>
        </Section>
      ) : null}

      {f.browse ? <Browse rpc={rpc} providerId={provider.id} hostId={hostId} busy={busy} act={(a) => act(a)} /> : null}

      {f.marketplaces && state.marketplaces ? (
        <Section title="Marketplaces">
          <ul className="divide-y divide-border">
            {state.marketplaces.map((m) => (
              <li key={m.name} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.source}</div>
                </div>
                {m.refreshable ? (
                  <button className={button} disabled={busy} onClick={() => act({ kind: "updateMarketplace", name: m.name })}>
                    Refresh
                  </button>
                ) : null}
                {m.removable ? (
                  <Confirm label="Remove" question={`Remove ${m.name}?`} disabled={busy} onConfirm={() => act({ kind: "removeMarketplace", name: m.name })} />
                ) : null}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => (e.preventDefault(), market.trim() && act({ kind: "addMarketplace", source: market.trim() }, () => setMarket("")))}
          >
            <input className={input} placeholder={provider.id === "acp-cursor" ? "Git repository URL" : "owner/repo, git URL or path"} value={market} onChange={(e) => setMarket(e.target.value)} />
            <button className={button} disabled={busy || market.trim() === ""}>
              Add marketplace
            </button>
          </form>
        </Section>
      ) : null}
    </div>
  );
}

function Page({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { providers, status } = experimental_useProviders();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [machineError, setMachineError] = useState<string | null>(null);
  useEffect(() => {
    rpc.call("machines", null).then(
      (r: { machines: Machine[]; defaultId: string | null }) => {
        setMachines(r.machines);
        setHostId((current) => current ?? r.defaultId);
      },
      (e: Error) => setMachineError(e.message),
    );
  }, [rpc]);

  // The tab list is bb's provider list: enabling or removing a provider plugin changes it.
  const selected = providers.find((p) => p.id === subPath.split("/")[0]) ?? providers[0];
  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate.toPluginPanel(PANEL, { subPath: p.id })}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent ${p.id === selected?.id ? "bg-accent font-medium" : "text-muted-foreground"}`}
            >
              <ProviderIcon providerKind="agent" provider={p} className="size-4" aria-hidden />
              {p.displayName}
            </button>
          ))}
          <span className="flex-1" />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Machine
            <select className="h-7 rounded-md border border-border bg-transparent px-1 text-xs" value={hostId ?? ""} onChange={(e) => setHostId(e.target.value)}>
              {machines.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.connected}>
                  {m.name}
                  {m.connected ? "" : " (offline)"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {machineError ? <ErrorText>{machineError}</ErrorText> : null}
        {status === "loading" ? <div className="text-sm text-muted-foreground">Loading providers…</div> : null}
        {status === "ready" && providers.length === 0 ? <div className="text-sm text-muted-foreground">No agent providers are running.</div> : null}
        {selected && hostId ? <AgentPanel key={`${selected.id}:${hostId}`} provider={selected} hostId={hostId} /> : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: PANEL, title: "Provider Plugins", icon: "Layers", path: PANEL, component: Page });
});
