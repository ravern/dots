import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useAppPanel,
  experimental_useFixedTabTarget,
  experimental_useProviders,
  UrlLink,
  useBbNavigate,
  useRpc,
  type JsonValue,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to bb's toaster
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEVIN_MARKETPLACE_URL, type Action, type Entry, type IconRef, type McpServer } from "./cli.ts";
import type { ActResult, InstalledPlugin, LoginResult, Machine, McpResult, rpcContract, State, StorePage, TerminalChunk } from "./server.ts";

const PANEL = "provider-plugins";
const VIEWS = ["installed", "store", "connections"] as const;
type View = (typeof VIEWS)[number];
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Provider = { id: string; displayName: string; logoUrl: string | null; icon?: { glyph: string } };
type Ready = Extract<State, { missing: false }>;
type Target = { providerId: string; hostId: string };
type Login = { terminalId: string; title: string; hostId: string };

// ── Routing: /plugins/provider-plugin-manager/provider-plugins/<provider>/<view>[/plugin/<id>]

function parseRoute(subPath: string) {
  const parts = subPath.split("/").filter(Boolean);
  const view: View = (VIEWS as readonly string[]).includes(parts[1]) ? (parts[1] as View) : "installed";
  const pluginId = parts[2] === "plugin" && parts[3] ? decodeURIComponent(parts[3]) : null;
  return { providerId: parts[0] ?? null, view, pluginId };
}

function useGo() {
  const navigate = useBbNavigate();
  return useCallback(
    (providerId: string, view: View, pluginId?: string) =>
      navigate.toPluginPanel(PANEL, { subPath: [providerId, view, ...(pluginId ? ["plugin", encodeURIComponent(pluginId)] : [])].join("/") }),
    [navigate],
  );
}

// ── Small pieces, in bb's own tokens (Plugins page classes)

function ErrorText({ children }: { children: ReactNode }) {
  return <pre className="whitespace-pre-wrap break-words rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{children}</pre>;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 leading-relaxed">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon name="Loader" className="size-4 animate-spin" aria-hidden />
      {children}
    </div>
  );
}

const TONES = {
  muted: "bg-muted text-subtle-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
};
function Badge({ tone = "muted", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-2xs font-medium", TONES[tone])}>{children}</span>;
}

function Initial({ name, large }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 font-medium text-muted-foreground",
        large ? "size-10 text-base" : "size-6 text-xs",
      )}
    >
      {(name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase()}
    </span>
  );
}

// ── Plugin icons: local files come from the machine through the plugin's host, batched and
// fetched only once a row scrolls into view; https URLs load directly. Anything that fails
// falls back to the letter avatar.

const HostContext = createContext<{ rpc: Rpc; hostId: string } | null>(null);
const iconCache = new Map<string, Promise<string | null>>();
let iconQueue: { key: string; hostId: string; ref: { base: string; rel: string }; rpc: Rpc; resolve: (v: string | null) => void }[] = [];

function flushIcons() {
  const queue = iconQueue;
  iconQueue = [];
  const byHost = new Map<string, typeof queue>();
  for (const q of queue) byHost.set(q.hostId, [...(byHost.get(q.hostId) ?? []), q]);
  for (const [hostId, items] of byHost) {
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      chunk[0].rpc.call("icons", { hostId, refs: chunk.map((c) => c.ref) }).then(
        (urls: (string | null)[]) => chunk.forEach((c, j) => c.resolve(urls[j] ?? null)),
        () => chunk.forEach((c) => (iconCache.delete(c.key), c.resolve(null))),
      );
    }
  }
}

function loadIcon(rpc: Rpc, hostId: string, ref: { base: string; rel: string }): Promise<string | null> {
  const key = `${hostId}\n${ref.base}\n${ref.rel}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = new Promise((resolve) => {
      if (iconQueue.length === 0) setTimeout(flushIcons, 30);
      iconQueue.push({ key, hostId, ref, rpc, resolve });
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function PluginIcon({ icon, name, large }: { icon: IconRef | null; name: string; large?: boolean }) {
  const host = useContext(HostContext);
  const box = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(icon && "url" in icon ? icon.url : null);
  const [failed, setFailed] = useState(false);
  const local = icon && "base" in icon ? icon : null;
  useEffect(() => {
    if (local === null || visible || !box.current) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    seen.observe(box.current);
    return () => seen.disconnect();
  }, [local?.base, local?.rel, visible]);
  useEffect(() => {
    if (!visible || local === null || host === null) return;
    let live = true;
    loadIcon(host.rpc, host.hostId, local).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [visible, local?.base, local?.rel, host?.hostId]);
  const size = large ? "size-10" : "size-6";
  if (src === null || failed) {
    return (
      <span ref={box} className="inline-flex shrink-0">
        <Initial name={name} large={large} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn(size, "shrink-0 rounded-md border border-border bg-background object-contain", large ? "p-1" : "p-0.5")}
    />
  );
}

/** bb's Install / Installed button. */
function InstallButton({ entry, busy, onInstall }: { entry: Entry; busy: boolean; onInstall: () => void }) {
  if (entry.installed) {
    return (
      <Button variant="ghost" size="sm" disabled className="h-7 shrink-0 gap-1.5 px-2 text-xs font-normal text-subtle-foreground shadow-none disabled:opacity-100">
        <Icon name="Check" className="size-3.5" aria-hidden />
        Installed
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy || !entry.installable}
      onClick={(e) => (e.stopPropagation(), onInstall())}
      className="h-7 shrink-0 gap-1.5 border-border/80 bg-background px-2 text-xs text-foreground shadow-none hover:bg-state-hover"
    >
      <Icon name="Download" className="size-3.5" aria-hidden />
      {entry.installable ? "Install" : "Unavailable"}
    </Button>
  );
}

/** A button that asks inline before running. */
function Confirm({ label, question, disabled, onConfirm }: { label: string; question: string; disabled: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs hover:text-destructive" disabled={disabled} onClick={(e) => (e.stopPropagation(), setAsking(true))}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
      <span className="text-muted-foreground">{question}</span>
      <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => (setAsking(false), onConfirm())}>
        {label}
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-medium text-subtle-foreground">{children}</h2>
      {action}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input className="h-8 pl-8 text-sm" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

function Chips({ options, value, onChange }: { options: { name: string; count: number }[]; value: string | null; onChange: (v: string | null) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      <Button variant="ghost" size="sm" aria-pressed={value === null} className="h-7 px-2 text-xs" onClick={() => onChange(null)}>
        All
      </Button>
      {options.slice(0, 14).map((o) => (
        <Button key={o.name} variant="ghost" size="sm" aria-pressed={value === o.name} className="h-7 gap-1 px-2 text-xs" onClick={() => onChange(value === o.name ? null : o.name)}>
          {o.name}
          <span className="tabular-nums text-subtle-foreground">{o.count}</span>
        </Button>
      ))}
    </div>
  );
}

// ── Actions shared by every view of one provider

function useActions(rpc: Rpc, target: Target, providerName: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useCallback(
    (action: Action, done?: () => void) => {
      setBusy(true);
      setError(null);
      rpc
        .call("act", { ...target, action })
        .then(
          (r: ActResult) => {
            if (!r.ok) return setError(r.output);
            done?.();
            toast.success(`Done. Applies to new ${providerName} threads.`);
          },
          (e: Error) => setError(e.message),
        )
        .finally(() => {
          setBusy(false);
          onChanged();
        });
    },
    [rpc, target.providerId, target.hostId, providerName, onChanged],
  );
  return { busy, error, act, clearError: () => setError(null) };
}
type Actions = ReturnType<typeof useActions>;

// ── Installed

function PluginActions({ plugin, state, actions }: { plugin: InstalledPlugin; state: Ready; actions: Actions }) {
  const f = state.features;
  if (!plugin.actionable) return null;
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {f.toggle && plugin.enabled !== null ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={actions.busy} onClick={() => actions.act({ kind: plugin.enabled ? "disable" : "enable", id: plugin.id })}>
          {plugin.enabled ? "Disable" : "Enable"}
        </Button>
      ) : null}
      {f.update ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={actions.busy} onClick={() => actions.act({ kind: "update", id: plugin.id })}>
          Update
        </Button>
      ) : null}
      {f.uninstall ? (
        <Confirm label="Uninstall" question={`Uninstall ${plugin.displayName}?`} disabled={actions.busy} onConfirm={() => actions.act({ kind: "uninstall", id: plugin.id })} />
      ) : null}
    </div>
  );
}

function PluginBadges({ plugin }: { plugin: InstalledPlugin }) {
  return (
    <>
      {plugin.version ? <Badge>{plugin.version}</Badge> : null}
      {plugin.enabled === false ? <Badge tone="warning">Disabled</Badge> : null}
      {plugin.scope && plugin.scope !== "user" ? <Badge>{plugin.scope}</Badge> : null}
    </>
  );
}

function InstallFromSource({ actions }: { actions: Actions }) {
  const [source, setSource] = useState("");
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => e.preventDefault()}>
      <Input className="h-8 min-w-0 flex-1 text-sm" placeholder="owner/repo, owner/repo#path/to/plugin, or a git URL" value={source} onChange={(e) => setSource(e.target.value)} />
      <Confirm
        label="Install"
        question="Trust and install this plugin's code?"
        disabled={actions.busy || source.trim() === ""}
        onConfirm={() => actions.act({ kind: "install", id: source.trim() }, () => setSource(""))}
      />
    </form>
  );
}

function InstalledView({ state, actions, open }: { state: Ready; actions: Actions; open: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const plugins = state.plugins ?? [];
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of plugins) for (const c of p.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [plugins]);
  const q = query.trim().toLowerCase();
  const shown = plugins.filter(
    (p) => (category === null || p.categories.includes(category)) && (q === "" || `${p.displayName} ${p.name} ${p.description} ${p.source}`.toLowerCase().includes(q)),
  );

  if (!state.features.plugins) {
    return <Notice>{state.note}</Notice>;
  }
  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search installed plugins" />
      <Chips options={categories} value={category} onChange={setCategory} />
      {state.features.installSource ? (
        <div className="space-y-1.5">
          <SectionTitle>Install from source</SectionTitle>
          <InstallFromSource actions={actions} />
        </div>
      ) : null}
      {plugins.length === 0 ? (
        <Empty>No plugins installed yet. Find some in the Store.</Empty>
      ) : shown.length === 0 ? (
        <Empty>No installed plugins match{q ? ` "${query}"` : " these filters"}.</Empty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {shown.map((p) => (
            <li
              key={`${p.id}:${p.scope}:${p.note}`}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-state-hover"
              onClick={() => open(p.id)}
            >
              <PluginIcon icon={p.icon} name={p.displayName} />
              <div className={cn("min-w-0 flex-1 space-y-0.5", p.enabled === false && "opacity-60")}>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{p.displayName}</span>
                  <PluginBadges plugin={p} />
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.description || p.note || p.id}</div>
                {p.source ? <div className="truncate text-2xs text-subtle-foreground">{p.source}</div> : null}
              </div>
              <PluginActions plugin={p} state={state} actions={actions} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Store

function StoreCard({ entry, busy, onInstall, onOpen }: { entry: Entry; busy: boolean; onInstall: () => void; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${entry.displayName} details`}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="group relative grid h-full min-h-36 w-full cursor-pointer grid-rows-[auto_1fr_auto] gap-2 rounded-xl border border-border bg-card p-3 text-left transition-[border-color,box-shadow,background-color] duration-150 hover:border-foreground/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-center gap-2">
        <PluginIcon icon={entry.icon} name={entry.displayName} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{entry.displayName}</span>
      </div>
      <span className="line-clamp-2 block min-h-[2lh] text-xs leading-snug text-muted-foreground">{entry.description || entry.name}</span>
      <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-subtle-foreground">
        <span className="min-w-0 truncate">
          {[entry.marketplace, entry.categories[0]].filter(Boolean).join(" · ")}
        </span>
        <InstallButton entry={entry} busy={busy} onInstall={onInstall} />
      </div>
    </div>
  );
}

function Marketplaces({ state, actions, isCursor }: { state: Ready; actions: Actions; isCursor: boolean }) {
  const [source, setSource] = useState("");
  if (!state.features.marketplaces || !state.marketplaces) return null;
  return (
    <section className="space-y-2">
      <SectionTitle>Marketplaces</SectionTitle>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {state.marketplaces.map((m) => (
          <li key={m.name} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{m.name}</div>
              <div className="truncate text-xs text-muted-foreground">{m.source}</div>
            </div>
            {m.refreshable ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={actions.busy} onClick={() => actions.act({ kind: "updateMarketplace", name: m.name })}>
                Refresh
              </Button>
            ) : null}
            {m.removable ? (
              <Confirm label="Remove" question={`Remove ${m.name}?`} disabled={actions.busy} onConfirm={() => actions.act({ kind: "removeMarketplace", name: m.name })} />
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => (e.preventDefault(), source.trim() && actions.act({ kind: "addMarketplace", source: source.trim() }, () => setSource("")))}
      >
        <Input className="h-8 min-w-0 flex-1 text-sm" placeholder={isCursor ? "Git repository URL" : "owner/repo, git URL or path"} value={source} onChange={(e) => setSource(e.target.value)} />
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={actions.busy || source.trim() === ""}>
          Add marketplace
        </Button>
      </form>
    </section>
  );
}

function StoreView({ rpc, target, state, actions, open }: { rpc: Rpc; target: Target; state: Ready; actions: Actions; open: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [page, setPage] = useState<StorePage | null>(null);
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    (offset: number, refresh = false) => {
      const mine = ++seq.current;
      setLoading(true);
      rpc
        .call("store", { ...target, query, category, marketplace, unavailable, offset, refresh })
        .then(
          (r: StorePage) => {
            if (mine !== seq.current) return;
            setPage(r);
            setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
          },
          (e: Error) => mine === seq.current && setPage({ items: [], total: 0, hiddenUnavailable: 0, categories: [], marketplaces: [], error: e.message }),
        )
        .finally(() => mine === seq.current && setLoading(false));
    },
    [rpc, target.providerId, target.hostId, query, category, marketplace, unavailable],
  );
  // Debounced search; filters reload immediately.
  useEffect(() => {
    const t = setTimeout(() => load(0), 200);
    return () => clearTimeout(t);
  }, [load]);
  // Installs change the Installed badges.
  const install = (entry: Entry) => actions.act({ kind: "install", id: entry.id }, () => load(0));

  if (state.agent === "cursor") {
    return (
      <div className="space-y-6">
        <Notice>
          <p>cursor-agent can't list or install plugins from its command line. Cursor installs them in its interactive plugin browser:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              Open this page's right panel, choose <b>New tab → Terminal</b> and pick this machine.
            </li>
            <li>
              Run <code className="font-mono">cursor-agent</code>, then type <code className="font-mono">/plugins</code>.
            </li>
          </ol>
          <p>Or install from the Cursor app. Plugins from the marketplaces below appear there.</p>
        </Notice>
        <Marketplaces state={state} actions={actions} isCursor />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search plugins..." />
        {page && page.marketplaces.length > 1 ? (
          <select
            aria-label="Marketplace"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
            value={marketplace ?? ""}
            onChange={(e) => setMarketplace(e.target.value || null)}
          >
            <option value="">All marketplaces</option>
            {page.marketplaces.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({m.count})
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" disabled={loading} onClick={() => load(0, true)}>
          <Icon name="ArrowReloadHorizontal" className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>
      {page ? <Chips options={page.categories} value={category} onChange={setCategory} /> : null}
      {state.agent === "devin" ? (
        <div className="text-xs text-subtle-foreground">
          From <UrlLink href={DEVIN_MARKETPLACE_URL} className="underline underline-offset-2 hover:text-foreground">CognitionAI/devin-marketplace</UrlLink>, the catalog behind Devin's Settings → Marketplace.
        </div>
      ) : null}
      {page?.error ? <ErrorText>{page.error}</ErrorText> : null}
      {page === null ? (
        <Loading>Loading the catalog…</Loading>
      ) : items.length === 0 && !loading ? (
        <Empty>{query ? `No plugins match "${query}".` : "No plugins match these filters."}</Empty>
      ) : (
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
          {items.map((e) => (
            <StoreCard key={e.id} entry={e} busy={actions.busy} onInstall={() => install(e)} onOpen={() => open(e.id)} />
          ))}
        </div>
      )}
      {page ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-subtle-foreground">
          <span className="tabular-nums">
            {items.length} of {page.total} plugin{page.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-3">
            {page.hiddenUnavailable > 0 || unavailable ? (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} />
                Show {page.hiddenUnavailable || ""} not installable for this account
              </label>
            ) : null}
            {items.length < page.total ? (
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={loading} onClick={() => load(items.length)}>
                Show more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {state.features.installSource ? (
        <section className="space-y-2">
          <SectionTitle>Install from source</SectionTitle>
          <InstallFromSource actions={actions} />
        </section>
      ) : null}
      <Marketplaces state={state} actions={actions} isCursor={false} />
    </div>
  );
}

// ── Connections (MCP servers)

const STATUS: Record<McpServer["status"], { label: string; tone: keyof typeof TONES }> = {
  connected: { label: "Connected", tone: "success" },
  "needs-auth": { label: "Needs login", tone: "warning" },
  failed: { label: "Failed", tone: "destructive" },
  disabled: { label: "Disabled", tone: "muted" },
  pending: { label: "Needs approval", tone: "warning" },
  loading: { label: "Loading", tone: "muted" },
  configured: { label: "Configured", tone: "muted" },
};

function useMcp(rpc: Rpc, target: Target) {
  const [result, setResult] = useState<McpResult | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    rpc
      .call("mcp", target)
      .then(setResult, (e: Error) => setResult({ servers: [], error: e.message }))
      .finally(() => setLoading(false));
  }, [rpc, target.providerId, target.hostId]);
  useEffect(load, [load]);
  return { result, loading, load };
}

function ServerRows({ servers, actions, login }: { servers: McpServer[]; actions: Actions; login: (server: string) => void }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {servers.map((s) => (
        <li key={s.name} className="space-y-1.5 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <PluginIcon icon={s.icon} name={s.plugin ?? s.name.replace(/^(claude\.ai |plugin:[^:]+:)/, "")} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                {s.plugin ? <Badge>from {s.plugin}</Badge> : null}
              </div>
              {s.target ? <div className="truncate font-mono text-2xs text-subtle-foreground">{s.target}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {s.login ? (
                <Button variant={s.status === "needs-auth" ? "outline" : "ghost"} size="sm" className="h-7 px-2 text-xs" onClick={() => login(s.name)}>
                  {s.status === "connected" || s.detail?.startsWith("Logged in") ? "Log in again" : "Log in"}
                </Button>
              ) : null}
              {s.enable ? (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={actions.busy} onClick={() => actions.act({ kind: "mcpEnable", name: s.name })}>
                  Enable
                </Button>
              ) : null}
              {s.disable ? (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={actions.busy} onClick={() => actions.act({ kind: "mcpDisable", name: s.name })}>
                  Disable
                </Button>
              ) : null}
              {s.logout ? <Confirm label="Log out" question={`Log out of ${s.name}?`} disabled={actions.busy} onConfirm={() => actions.act({ kind: "mcpLogout", name: s.name })} /> : null}
            </div>
          </div>
          {s.status === "failed" && s.detail ? <ErrorText>{s.detail}</ErrorText> : s.detail ? <div className="text-xs text-muted-foreground">{s.detail}</div> : null}
          {s.hint ? <div className="text-xs text-muted-foreground">{s.hint}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function ConnectionsView({ rpc, target, state, actions, login }: { rpc: Rpc; target: Target; state: Ready; actions: Actions; login: (server: string) => void }) {
  const { result, loading, load } = useMcp(rpc, target);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const servers = result?.servers ?? [];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of servers) m.set(STATUS[s.status].label, (m.get(STATUS[s.status].label) ?? 0) + 1);
    return [...m].map(([name, count]) => ({ name, count }));
  }, [servers]);
  const q = query.trim().toLowerCase();
  const shown = servers.filter((s) => (status === null || STATUS[s.status].label === status) && (q === "" || `${s.name} ${s.target} ${s.plugin ?? ""}`.toLowerCase().includes(q)));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search MCP servers" />
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" disabled={loading} onClick={load}>
          <Icon name="ArrowReloadHorizontal" className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          Check again
        </Button>
      </div>
      <Chips options={counts} value={status} onChange={setStatus} />
      <div className="text-xs text-subtle-foreground">
        MCP servers from {state.bin}'s config and its plugins. Logins open in the <b>Login</b> tab of this page's right panel. Running threads keep their old
        connections until restarted.
        {state.agent === "devin" ? " Devin's CLI doesn't report connection status." : ""}
        {state.agent === "codex" ? " Codex's CLI reports login state, not live health." : ""}
      </div>
      {result?.error ? <ErrorText>{result.error}</ErrorText> : null}
      {result === null ? (
        <Loading>{state.agent === "claude" ? "Checking every MCP server (Claude Code health-checks each one; this can take ~15 s)…" : "Loading MCP servers…"}</Loading>
      ) : servers.length === 0 ? (
        <Empty>No MCP servers configured.</Empty>
      ) : (
        <ServerRows servers={shown} actions={actions} login={login} />
      )}
    </div>
  );
}

// ── Plugin detail

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function DetailView({ rpc, target, state, actions, id, back, login }: { rpc: Rpc; target: Target; state: Ready; actions: Actions; id: string; back: () => void; login: (server: string) => void }) {
  const [entry, setEntry] = useState<Entry | null | undefined>(undefined);
  useEffect(() => {
    rpc.call("entry", { ...target, id }).then(setEntry, () => setEntry(null));
  }, [rpc, target.providerId, target.hostId, id]);
  const plugin = state.plugins?.find((p) => p.id === id || p.name === id) ?? null;
  const { result } = useMcp(rpc, target);
  const name = plugin?.name ?? entry?.name ?? id;
  const servers = (result?.servers ?? []).filter((s) => s.plugin === name || (entry?.mcpServers.includes(s.name) ?? false));
  const displayName = plugin?.displayName ?? entry?.displayName ?? id;

  return (
    <div className="space-y-5">
      <button onClick={back} className="inline-flex items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <Icon name="ChevronLeft" className="size-3" aria-hidden />
        Back
      </button>
      <div className="flex items-start gap-3">
        <PluginIcon icon={plugin?.icon ?? entry?.icon ?? null} name={displayName} large />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground">
            {displayName}
            {plugin ? <Badge tone="success">Installed</Badge> : null}
            {plugin ? <PluginBadges plugin={plugin} /> : null}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">{entry?.description || plugin?.description || (entry === undefined ? "…" : "No description.")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {plugin ? <PluginActions plugin={plugin} state={state} actions={actions} /> : entry ? <InstallButton entry={entry} busy={actions.busy} onInstall={() => actions.act({ kind: "install", id: entry.id })} /> : null}
        </div>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
        <Row label="ID">
          <span className="font-mono">{plugin?.id ?? entry?.id ?? id}</span>
        </Row>
        {plugin?.source || entry?.marketplace ? <Row label="Marketplace">{plugin?.source || entry?.marketplace}</Row> : null}
        {entry?.categories.length ? <Row label="Categories">{entry.categories.join(", ")}</Row> : null}
        {entry?.author ? <Row label="Author">{entry.author}</Row> : null}
        {plugin?.version ? <Row label="Version">{plugin.version}</Row> : null}
        {plugin?.note ? <Row label="Scope">{plugin.note}</Row> : null}
        {entry?.homepage || plugin?.homepage ? (
          <Row label="Homepage">
            <UrlLink href={(entry?.homepage || plugin?.homepage)!} className="underline underline-offset-2 hover:text-foreground">
              {entry?.homepage || plugin?.homepage}
            </UrlLink>
          </Row>
        ) : null}
      </dl>
      {plugin && !plugin.actionable ? <Notice>This plugin is installed for another project ({plugin.note}); manage it from Claude Code in that project.</Notice> : null}
      <section className="space-y-2">
        <SectionTitle>Connections</SectionTitle>
        {result === null ? (
          <Loading>Checking MCP servers…</Loading>
        ) : servers.length === 0 ? (
          <div className="text-xs text-subtle-foreground">No MCP servers linked to this plugin{state.agent === "codex" || state.agent === "cursor" ? " (this CLI doesn't say which plugin a server came from; see Connections)" : ""}.</div>
        ) : (
          <ServerRows servers={servers} actions={actions} login={login} />
        )}
      </section>
    </div>
  );
}

// ── One provider

function AgentPanel({ provider, hostId, machineName, view, pluginId }: { provider: Provider; hostId: string; machineName: string; view: View; pluginId: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const go = useGo();
  const panel = experimental_useAppPanel();
  const target = useMemo(() => ({ providerId: provider.id, hostId }), [provider.id, hostId]);
  const hostValue = useMemo(() => ({ rpc, hostId }), [rpc, hostId]);
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(() => {
    rpc.call("state", target).then(
      (s: State) => (setState(s), setLoadError(null)),
      (e: Error) => setLoadError(e.message),
    );
  }, [rpc, target]);
  useEffect(load, [load]);
  const actions = useActions(rpc, target, provider.displayName, load);

  const login = (server: string) => {
    rpc.call("login", { ...target, server }).then(
      (r: LoginResult) => {
        const opened = panel.openFixedTab({ surface: { kind: "current" }, tab: LOGIN_TAB, target: { ...r, hostId } });
        toast(opened ? `Follow the login in the Login tab.` : `Login started: run "bb terminal attach ${r.terminalId}" to see it.`);
      },
      (e: Error) => toast.error(e.message),
    );
  };

  const restart = () => {
    setRestarting(true);
    rpc
      .call("restartIdle", target)
      .then(({ stopped, busy }: { stopped: number; busy: number }) => {
        const rest = busy ? ` ${busy} busy thread${busy === 1 ? "" : "s"} left alone.` : "";
        toast.success(`Restarted ${stopped} idle ${provider.displayName} thread${stopped === 1 ? "" : "s"}; each resumes on its next message.${rest}`);
      }, (e: Error) => toast.error(e.message))
      .finally(() => setRestarting(false));
  };

  if (loadError) return <ErrorText>{loadError}</ErrorText>;
  if (state === null) return <Loading>Loading {provider.displayName} plugins…</Loading>;
  if (state.agent === null) return <Empty>Plugin management isn't supported for {provider.displayName} yet.</Empty>;
  if (state.missing) {
    return (
      <div className="opacity-60">
        <Empty>
          <code className="font-mono">{state.bin}</code> isn't installed on {machineName}.
          <div className="mt-1 text-xs">Install the {provider.displayName} CLI there, or pick another machine.</div>
        </Empty>
      </div>
    );
  }

  const tabs: { view: View; label: string; count?: number }[] = [
    { view: "installed", label: "Installed", count: state.plugins?.length },
    { view: "store", label: "Store" },
    { view: "connections", label: "Connections" },
  ];
  return (
    <HostContext.Provider value={hostValue}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {provider.displayName}'s own plugins on {machineName}, via <code className="font-mono">{state.bin}</code> {state.version}. Changes apply to new threads.
        </p>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={restarting} onClick={restart}>
          <Icon name="ArrowReloadHorizontal" className="size-3.5" aria-hidden />
          Restart idle {provider.displayName} threads
        </Button>
      </div>
      {pluginId === null ? (
        <nav className="flex gap-1 border-b border-border" aria-label="Views">
          {tabs.map((t) => (
            <button
              key={t.view}
              onClick={() => go(provider.id, t.view)}
              aria-current={view === t.view ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-sm transition-colors",
                view === t.view ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.count !== undefined ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-2xs font-medium tabular-nums text-subtle-foreground">{t.count}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}
      {state.note && pluginId === null && state.agent !== "cursor" ? <Notice>{state.note}</Notice> : null}
      {state.errors.map((e) => (
        <ErrorText key={e}>{e}</ErrorText>
      ))}
      {actions.error ? <ErrorText>{actions.error}</ErrorText> : null}
      {pluginId !== null ? (
        <DetailView rpc={rpc} target={target} state={state} actions={actions} id={pluginId} back={() => go(provider.id, view)} login={login} />
      ) : view === "store" ? (
        <StoreView rpc={rpc} target={target} state={state} actions={actions} open={(id) => go(provider.id, "store", id)} />
      ) : view === "connections" ? (
        <ConnectionsView rpc={rpc} target={target} state={state} actions={actions} login={login} />
      ) : (
        <InstalledView state={state} actions={actions} open={(id) => go(provider.id, "installed", id)} />
      )}
    </div>
    </HostContext.Provider>
  );
}

// ── Login terminal (right panel)

const isLogin = (v: JsonValue): v is Login =>
  typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.terminalId === "string" && typeof v.title === "string" && typeof v.hostId === "string";

function LoginTerminal() {
  const rpc = useRpc<typeof rpcContract>();
  const state = experimental_useFixedTabTarget(LOGIN_TAB);
  const login = state?.target ?? null;
  const [text, setText] = useState("");
  const [chunk, setChunk] = useState<TerminalChunk | null>(null);
  const [input, setInput] = useState("");
  const out = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (login === null) return;
    setText("");
    setChunk(null);
    let seq = 0;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        const r: TerminalChunk = await rpc.call("terminalOutput", { terminalId: login.terminalId, sinceSeq: seq }).catch(() => ({ text: "", nextSeq: seq, running: false, exitCode: null }));
        if (stopped) return;
        seq = r.nextSeq;
        if (r.text) setText((t) => (t + r.text).slice(-64 * 1024));
        setChunk(r);
        if (!r.running) return;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [rpc, login?.terminalId]);
  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight });
  }, [text]);

  if (login === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No login running. Use <b>Log in</b> on a server in a provider's Connections view; its browser or device-code login runs here.
      </div>
    );
  }
  const send = (data: string) => rpc.call("terminalInput", { terminalId: login.terminalId, text: data }).catch((e: Error) => toast.error(e.message));
  const running = chunk?.running ?? true;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{login.title}</span>
        {running ? <Badge tone="warning">Running</Badge> : <Badge tone={chunk?.exitCode === 0 ? "success" : "destructive"}>Exited {chunk?.exitCode ?? ""}</Badge>}
        {running ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void send("\x03")}>
            Ctrl-C
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            void rpc.call("terminalClose", { terminalId: login.terminalId });
            state?.clear();
          }}
        >
          Close
        </Button>
      </div>
      <pre ref={out} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/30 p-2 font-mono text-xs text-foreground">
        {text || "Starting…"}
      </pre>
      {running ? (
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void send(`${input}\r`), setInput(""))}>
          <Input className="h-8 min-w-0 flex-1 font-mono text-xs" placeholder="Type a reply (e.g. a pasted code or URL) and press Enter" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button variant="outline" size="sm" className="h-8 text-xs">
            Send
          </Button>
        </form>
      ) : (
        <div className="text-xs text-muted-foreground">Done. Back in Connections, press Check again.</div>
      )}
      <div className="text-2xs text-subtle-foreground">
        Full terminal: <code className="font-mono">bb terminal attach {login.terminalId}</code>
      </div>
    </div>
  );
}

const LOGIN_TAB = {
  id: "login",
  panelId: PANEL,
  title: "Login",
  icon: "Lock",
  component: LoginTerminal,
  layout: "flush" as const,
  experimental_target: { validate: isLogin },
};

// ── Page

function Page({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const go = useGo();
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

  const route = parseRoute(subPath);
  // The tabs are bb's provider list: enabling or removing a provider plugin changes them.
  const selected = providers.find((p) => p.id === route.providerId) ?? providers[0];
  const machine = machines.find((m) => m.id === hostId);
  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center gap-1">
          {providers.map((p) => (
            <Button key={p.id} variant="ghost" size="sm" aria-pressed={p.id === selected?.id} className="h-8 gap-1.5 px-2.5 text-sm" onClick={() => go(p.id, route.view)}>
              <ProviderIcon providerKind="agent" provider={p} className="size-4" aria-hidden />
              {p.displayName}
            </Button>
          ))}
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon name="Laptop" className="size-3.5" aria-hidden />
            <select
              aria-label="Machine"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
              value={hostId ?? ""}
              onChange={(e) => setHostId(e.target.value)}
            >
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
        {status === "loading" ? <Loading>Loading providers…</Loading> : null}
        {status === "ready" && providers.length === 0 ? <Empty>No agent providers are running.</Empty> : null}
        {selected && hostId ? (
          <AgentPanel key={`${selected.id}:${hostId}`} provider={selected} hostId={hostId} machineName={machine?.name ?? "this machine"} view={route.view} pluginId={route.pluginId} />
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: PANEL, title: "Provider Plugins", icon: "Layers", path: PANEL, component: Page, fixedTabs: [LOGIN_TAB] });
});
