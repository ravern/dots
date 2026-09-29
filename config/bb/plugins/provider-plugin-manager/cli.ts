import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** The agents whose own plugin CLIs this plugin drives, keyed by bb provider id. */
export type Agent = "claude" | "codex" | "cursor" | "devin";
export const PROVIDER_AGENTS: Readonly<Record<string, Agent>> = {
  "claude-code": "claude",
  codex: "codex",
  "acp-cursor": "cursor",
  "devin-cloud": "devin",
};
export const BINS = ["claude", "codex", "cursor-agent", "devin"] as const;
export const BIN: Record<Agent, (typeof BINS)[number]> = { claude: "claude", codex: "codex", cursor: "cursor-agent", devin: "devin" };

/** What each CLI can do; the UI offers nothing else. */
export type Features = {
  plugins: boolean; // list installed plugins
  toggle: boolean; // enable/disable
  update: boolean; // update one plugin
  uninstall: boolean;
  store: boolean; // a catalog to browse and install from
  installSource: boolean; // install from a source (owner/repo, git URL, path)
  marketplaces: boolean; // list/add/remove/refresh marketplaces
};
export const FEATURES: Record<Agent, Features> = {
  claude: { plugins: true, toggle: true, update: true, uninstall: true, store: true, installSource: false, marketplaces: true },
  codex: { plugins: true, toggle: false, update: false, uninstall: true, store: true, installSource: false, marketplaces: true },
  cursor: { plugins: false, toggle: false, update: false, uninstall: false, store: false, installSource: false, marketplaces: true },
  devin: { plugins: true, toggle: false, update: true, uninstall: true, store: true, installSource: true, marketplaces: false },
};

export const NOTES: Partial<Record<Agent, string>> = {
  codex: "Codex's CLI can't enable, disable or update single plugins; refreshing a marketplace pulls its latest plugins.",
  cursor:
    "cursor-agent's CLI can't list or install plugins: it installs them in its interactive /plugins browser (or the Cursor app). Its CLI manages marketplaces and MCP servers.",
  devin:
    "Installs go to your Devin personal plugins, which sync to your account. The Devin CLI warns that a plugin whose source isn't reachable from the cloud (e.g. a local path) won't load in cloud sessions like bb's Devin Cloud threads.",
};

/** Devin's public catalog; its plugins install as `<repo>#plugins/<dir>`. */
export const DEVIN_MARKETPLACE = "CognitionAI/devin-marketplace";
export const DEVIN_MARKETPLACE_URL = `https://github.com/${DEVIN_MARKETPLACE}`;

export type Plugin = {
  id: string; // what the CLI takes to act on it
  name: string;
  source: string; // marketplace, or where it came from
  version: string | null;
  enabled: boolean | null; // null: the CLI doesn't say
  scope: string | null;
  actionable: boolean; // false for rows the UI only shows (e.g. another project's plugin)
  note: string | null;
};
export type Marketplace = { name: string; source: string; removable: boolean; refreshable: boolean };
/** A plugin's icon: a file inside its plugin dir on the machine (served by the host), or an https URL. */
export type IconRef = { base: string; rel: string } | { url: string };
/** One store listing. */
export type Entry = {
  id: string; // what install takes
  name: string;
  displayName: string;
  description: string;
  marketplace: string;
  categories: string[];
  author: string | null;
  homepage: string | null;
  installed: boolean;
  installable: boolean;
  mcpServers: string[];
  icon: IconRef | null;
};
export type McpStatus = "connected" | "needs-auth" | "failed" | "disabled" | "pending" | "loading" | "configured";
export type McpServer = {
  name: string;
  target: string; // URL or command
  status: McpStatus;
  detail: string | null; // error or auth mode
  hint: string | null;
  plugin: string | null; // the plugin that brought it, when the CLI says
  icon: IconRef | null; // that plugin's icon
  login: boolean;
  logout: boolean;
  enable: boolean;
  disable: boolean;
};

export type Action =
  | { kind: "enable" | "disable" | "update" | "uninstall" | "install"; id: string }
  | { kind: "addMarketplace"; source: string }
  | { kind: "removeMarketplace" | "updateMarketplace"; name: string }
  | { kind: "mcpLogout" | "mcpEnable" | "mcpDisable"; name: string };

// Passed as argv (no shell), so the only risk is an option-looking value.
const arg = z.string().trim().min(1).max(500).regex(/^[^-\s][^\s]*$/, "Must be one word that doesn't start with -");
// MCP server names can hold spaces ("claude.ai Linear").
export const mcpName = z.string().trim().min(1).max(200).regex(/^[^-\s][^\n\r\0]*$/, "Not a server name");
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["enable", "disable", "update", "uninstall", "install"]), id: arg }).strict(),
  z.object({ kind: z.literal("addMarketplace"), source: arg }).strict(),
  z.object({ kind: z.enum(["removeMarketplace", "updateMarketplace"]), name: arg }).strict(),
  z.object({ kind: z.enum(["mcpLogout", "mcpEnable", "mcpDisable"]), name: mcpName }).strict(),
]);

/** Server → host: run an allowlisted agent CLI, read catalog manifests, fetch Devin's catalog. */
export const hostContract = defineRpcContract({
  run: {
    input: z.object({ bin: z.enum(BINS), args: z.array(z.string().max(500)).max(16) }).strict(),
    output: z.object({ missing: z.boolean(), code: z.number().nullable(), stdout: z.string(), stderr: z.string() }),
  },
  // Only catalog manifests: marketplace.json / plugin.json, by absolute path.
  readManifests: {
    input: z.object({ paths: z.array(z.string().regex(/^~?\/.*\/(marketplace|plugin)\.json$/).max(1000)).max(800) }).strict(),
    output: z.record(z.string(), z.unknown()),
  },
  // Image files only, inside the plugin dir the ref names; returned as data URLs.
  readIcons: {
    input: z.object({ refs: z.array(z.object({ base: z.string().max(1000), rel: z.string().max(300) }).strict()).max(100) }).strict(),
    output: z.array(z.string().nullable()),
  },
  devinCatalog: {
    input: z.null(),
    output: z.object({ manifests: z.record(z.string(), z.unknown()), error: z.string().nullable() }),
  },
});

export const LIST = {
  plugins: { claude: ["plugin", "list", "--json"], codex: ["plugin", "list", "--json"], devin: ["plugins", "list"] },
  catalog: { claude: ["plugin", "list", "--json", "--available"], codex: ["plugin", "list", "--available", "--json"] },
  marketplaces: {
    claude: ["plugin", "marketplace", "list", "--json"],
    codex: ["plugin", "marketplace", "list", "--json"],
    cursor: ["plugin", "marketplace", "list", "--format", "json"],
  },
  mcp: { claude: ["mcp", "list"], codex: ["mcp", "list", "--json"], cursor: ["mcp", "list"], devin: ["mcp", "list"] },
} satisfies Record<string, Partial<Record<Agent, string[]>>>;
export const VERSION_ARGS = ["--version"];

/** The CLI argv for an action, or null when this agent's CLI can't do it. */
export function actionArgv(agent: Agent, action: Action): string[] | null {
  const f = FEATURES[agent];
  switch (action.kind) {
    case "enable":
    case "disable":
      return f.toggle ? ["plugin", action.kind, action.id, "--scope", "user"] : null;
    case "update":
      if (!f.update) return null;
      return agent === "devin" ? ["plugins", "update", action.id] : ["plugin", "update", action.id, "--scope", "user"];
    case "uninstall":
      if (!f.uninstall) return null;
      if (agent === "claude") return ["plugin", "uninstall", action.id, "--scope", "user"];
      if (agent === "codex") return ["plugin", "remove", action.id];
      return ["plugins", "remove", action.id, "--yes"]; // the UI asked first; --yes skips Devin's TTY prompt
    case "install":
      if (agent === "claude") return ["plugin", "install", action.id, "--scope", "user"];
      if (agent === "codex") return ["plugin", "add", action.id];
      if (agent === "devin") return ["plugins", "install", action.id, "--yes"]; // the UI asked first (trust)
      return null;
    case "addMarketplace":
      return f.marketplaces ? ["plugin", "marketplace", "add", action.source] : null;
    case "removeMarketplace":
      return f.marketplaces ? ["plugin", "marketplace", "remove", action.name] : null;
    case "updateMarketplace":
      if (!f.marketplaces) return null;
      return ["plugin", "marketplace", agent === "codex" ? "upgrade" : "update", action.name];
    case "mcpLogout":
      return agent === "cursor" ? null : ["mcp", "logout", action.name];
    case "mcpEnable":
    case "mcpDisable":
      return agent === "cursor" ? ["mcp", action.kind === "mcpEnable" ? "enable" : "disable", action.name] : null;
  }
}

/** Interactive MCP login (browser/OAuth): argv for a terminal the user watches. */
export const loginArgv = (name: string): string[] => ["mcp", "login", name];

/** One shell word, for a terminal's command line. */
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
const splitId = (id: string) => {
  const at = id.lastIndexOf("@");
  return at > 0 ? { name: id.slice(0, at), market: id.slice(at + 1) } : { name: id, market: "" };
};
const json = (stdout: string): any => JSON.parse(stdout);
// Strips ANSI escapes some CLIs print even when piped.
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
const title = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const author = (v: any): string | null => str(v?.name) || str(v) || null;

/**
 * Installed plugins from the CLI's list output. Only the fields the UI shows are kept: Claude's
 * list also carries MCP server configs (auth headers), which never leave this function.
 */
export function parsePlugins(agent: Agent, stdout: string): Plugin[] {
  if (agent === "claude") {
    const rows: any[] = json(stdout);
    return rows.map((r) => {
      const { name, market } = splitId(str(r.id));
      const scope = str(r.scope) || null;
      const project = str(r.projectPath);
      return {
        id: str(r.id),
        name,
        source: market,
        version: str(r.version) && r.version !== "unknown" ? r.version : null,
        enabled: typeof r.enabled === "boolean" ? r.enabled : null,
        scope,
        // ponytail: user scope only; project/local plugins need that project's cwd. Manage those in Claude Code.
        actionable: scope === "user",
        note: scope !== "user" && project ? `${scope}: ${project}` : null,
      };
    });
  }
  if (agent === "codex") {
    const rows: any[] = json(stdout).installed ?? [];
    return rows.map((r) => ({
      id: str(r.pluginId),
      name: str(r.name) || splitId(str(r.pluginId)).name,
      source: str(r.marketplaceName),
      version: str(r.version) || null,
      enabled: typeof r.enabled === "boolean" ? r.enabled : null,
      scope: null,
      actionable: true,
      note: null,
    }));
  }
  if (agent === "devin") {
    // "Installed plugins\n\n  • notion unversioned\n  • foo 1.2.0 [blocked by …]"
    return plain(stdout)
      .split("\n")
      .map((line) => /^\s*•\s+(\S+)(?:\s+(\S+))?\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(([, name, version, rest]) => ({
        id: name,
        name,
        source: "",
        version: version && version !== "unversioned" ? version : null,
        enabled: null,
        scope: null,
        actionable: true,
        note: rest.trim() || null,
      }));
  }
  return [];
}

export function parseMarketplaces(agent: Agent, stdout: string): Marketplace[] {
  if (agent === "claude") {
    const rows: any[] = json(stdout);
    return rows.map((r) => ({ name: str(r.name), source: str(r.repo) || str(r.url) || str(r.path), removable: true, refreshable: true }));
  }
  if (agent === "codex") {
    const rows: any[] = json(stdout).marketplaces ?? [];
    // Entries without a source (and openai-*) are Codex's own; only git ones can be refreshed.
    return rows.map((r) => ({
      name: str(r.name),
      source: str(r.marketplaceSource?.source) || str(r.root),
      removable: r.marketplaceSource !== undefined && !str(r.name).startsWith("openai-"),
      refreshable: r.marketplaceSource?.sourceType === "git",
    }));
  }
  if (agent === "cursor") {
    const rows: any[] = json(stdout);
    // "global" ones (Cursor's own) can't be changed.
    return rows.map((r) => {
      const user = r.scope === "user";
      return { name: str(r.name), source: str(r.gitUrl) || str(r.displayName), removable: user, refreshable: user };
    });
  }
  return [];
}

export const IMAGE = /\.(png|svg|webp|jpe?g|gif)$/i;
// Many plugins ship a manifest per agent; any of them may name the icon.
export const ICON_MANIFESTS = [".codex-plugin/plugin.json", ".cursor-plugin/plugin.json", ".claude-plugin/plugin.json"];

/** The icon a manifest names (Codex's interface.composerIcon/logo, else a top-level logo/icon), relative to `base`. */
export function manifestIcon(manifest: unknown, base: string): IconRef | null {
  const m: any = manifest ?? {};
  const v = str(m.interface?.composerIcon) || str(m.interface?.logo) || str(m.logo) || str(m.icon);
  if (/^https:\/\//.test(v)) return { url: v };
  // A relative image path that stays in the plugin dir; the host re-checks after resolving links.
  if (!v || !IMAGE.test(v) || v.startsWith("/") || /^[a-z]+:/i.test(v) || v.split(/[\\/]/).includes("..")) return null;
  return { base, rel: v.replace(/^\.\//, "") };
}

/** The first icon any manifest in `dir` names; `read` maps manifest paths to their JSON. */
export function dirIcon(dir: string | undefined, read: Record<string, unknown>): IconRef | null {
  if (!dir) return null;
  for (const m of ICON_MANIFESTS) {
    const icon = manifestIcon(read[`${dir}/${m}`], dir);
    if (icon) return icon;
  }
  return null;
}
export const iconManifestPaths = (dirs: Iterable<string>) => [...new Set(dirs)].flatMap((d) => ICON_MANIFESTS.map((m) => `${d}/${m}`));

/** Where each Claude plugin lives on disk: its install path, or its folder in a marketplace clone. */
export function claudePluginDirs(availableJson: string, manifests: Record<string, unknown>, roots: Record<string, string>): Record<string, string> {
  const dirs: Record<string, string> = {};
  for (const [market, manifest] of Object.entries(manifests)) {
    for (const p of ((manifest as any)?.plugins ?? []) as any[]) {
      const source = str(p.source);
      if (roots[market] && str(p.name) && source.startsWith("./") && !source.split("/").includes("..")) {
        dirs[`${p.name}@${market}`] = `${roots[market]}/${source.slice(2)}`.replace(/\/+$/, "");
      }
    }
  }
  for (const r of (json(availableJson).installed ?? []) as any[]) if (str(r.installPath).startsWith("/")) dirs[str(r.id)] = r.installPath;
  return dirs;
}

/** Where each Codex plugin's files are: its local source, or (installed) Codex's plugin cache. */
export function codexPluginDirs(catalogJson: string): Record<string, string[]> {
  const data = json(catalogJson);
  const dirs: Record<string, string[]> = {};
  for (const r of [...(data.installed ?? []), ...(data.available ?? [])] as any[]) {
    const id = str(r.pluginId);
    const list = (dirs[id] ??= []);
    if (str(r.source?.path).startsWith("/") && !list.includes(r.source.path)) list.push(r.source.path);
    const [name, market, version] = [str(r.name), str(r.marketplaceName), str(r.version)];
    if (r.installed === true && [name, market, version].every((x) => /^[\w.+-]+$/.test(x))) {
      const cache = `~/.codex/plugins/cache/${market}/${name}/${version}`;
      if (!list.includes(cache)) list.push(cache);
    }
  }
  return dirs;
}

/** Where each marketplace's catalog manifest lives (Claude), keyed by marketplace name. */
export function claudeManifestPaths(marketplacesJson: string): Record<string, string> {
  const rows: any[] = json(marketplacesJson);
  return Object.fromEntries(
    rows.filter((r) => str(r.installLocation).startsWith("/")).map((r) => [str(r.name), `${r.installLocation}/.claude-plugin/marketplace.json`]),
  );
}

/** Marketplace roots (Claude's clones), keyed by marketplace name. */
export function claudeMarketplaceRoots(marketplacesJson: string): Record<string, string> {
  const rows: any[] = json(marketplacesJson);
  return Object.fromEntries(rows.filter((r) => str(r.installLocation).startsWith("/")).map((r) => [str(r.name), str(r.installLocation)]));
}

/** Where Codex plugins with files on disk keep their manifest (uninstalled remote ones have none). */
export function codexManifestPaths(catalogJson: string): string[] {
  return [...new Set(Object.values(codexPluginDirs(catalogJson)).flat())].map((d) => `${d}/.codex-plugin/plugin.json`);
}

/**
 * The store: every listing the CLI can install, enriched from the catalog manifests when they
 * could be read (`manifests` maps a marketplace name (Claude) or manifest path (Codex) to its JSON).
 * Claude's icons come from the plugin dirs' own manifests: `dirs` (claudePluginDirs) and `read`.
 */
export function parseCatalog(
  agent: Agent,
  stdout: string,
  manifests: Record<string, unknown>,
  icons: { dirs: Record<string, string>; read: Record<string, unknown> } = { dirs: {}, read: {} },
): Entry[] {
  const data = json(stdout);
  const byId = new Map<string, Entry>();
  const add = (e: Entry) => {
    const prev = byId.get(e.id);
    byId.set(e.id, { ...prev, ...e, icon: e.icon ?? prev?.icon ?? null, description: e.description || prev?.description || "" });
  };
  if (agent === "claude") {
    const installed = new Set<string>((data.installed ?? []).map((r: any) => str(r.id)));
    for (const [market, manifest] of Object.entries(manifests)) {
      for (const p of ((manifest as any)?.plugins ?? []) as any[]) {
        const id = `${str(p.name)}@${market}`;
        if (!str(p.name)) continue;
        add({
          id,
          name: str(p.name),
          displayName: title(str(p.name)),
          description: str(p.description),
          marketplace: market,
          categories: str(p.category) ? [title(str(p.category))] : [],
          author: author(p.author),
          homepage: str(p.homepage) || null,
          installed: installed.has(id),
          installable: true,
          mcpServers: [],
          icon: dirIcon(icons.dirs[id], icons.read),
        });
      }
    }
    for (const r of (data.available ?? []) as any[]) {
      const id = str(r.pluginId);
      if (!id || byId.has(id)) continue;
      add({
        id,
        name: str(r.name) || splitId(id).name,
        displayName: title(str(r.name) || splitId(id).name),
        description: str(r.description),
        marketplace: str(r.marketplaceName),
        categories: [],
        author: null,
        homepage: null,
        installed: installed.has(id),
        installable: true,
        mcpServers: [],
        icon: dirIcon(icons.dirs[id], icons.read),
      });
    }
  } else if (agent === "codex") {
    const dirs = codexPluginDirs(stdout);
    for (const r of [...(data.available ?? []), ...(data.installed ?? [])] as any[]) {
      const id = str(r.pluginId);
      if (!id) continue;
      const dir = (dirs[id] ?? []).find((d) => manifests[`${d}/.codex-plugin/plugin.json`]);
      const m: any = dir ? manifests[`${dir}/.codex-plugin/plugin.json`] : null;
      const name = str(r.name) || splitId(id).name;
      add({
        id,
        name,
        displayName: str(m?.interface?.displayName) || title(name),
        description: str(m?.interface?.shortDescription) || str(m?.description),
        marketplace: str(r.marketplaceName),
        categories: str(m?.interface?.category) ? [str(m.interface.category)] : [],
        author: str(m?.interface?.developerName) || author(m?.author),
        homepage: str(m?.interface?.websiteURL) || str(m?.homepage) || null,
        installed: r.installed === true,
        // Most of Codex's remote catalog isn't installable for this account.
        installable: r.installPolicy !== "NOT_AVAILABLE",
        mcpServers: [],
        icon: dir ? manifestIcon(m, dir) : null,
      });
    }
  }
  return [...byId.values()];
}

/** Devin's catalog from its marketplace repo: `manifests` maps a plugin dir to its plugin.json. */
export function parseDevinCatalog(manifests: Record<string, unknown>, installedNames: ReadonlySet<string>): Entry[] {
  return Object.entries(manifests).map(([dir, raw]) => {
    const m: any = raw ?? {};
    const name = str(m.name) || dir;
    return {
      id: `${DEVIN_MARKETPLACE}#plugins/${dir}`,
      name,
      displayName: str(m.displayName) || title(name),
      description: str(m.description),
      marketplace: "devin-marketplace",
      categories: strs(m.keywords),
      author: author(m.author),
      homepage: str(m.homepage) || null,
      installed: installedNames.has(name),
      installable: true,
      mcpServers: Object.keys(m.mcpServers ?? {}),
      // `@devin/<dir>`: the host's checkout of the marketplace.
      icon: /^(?!\.+$)[\w.-]+$/.test(dir) ? manifestIcon(m, `@devin/${dir}`) : null,
    };
  });
}

export type StoreQuery = { query: string; category: string | null; marketplace: string | null; unavailable: boolean; offset: number; limit: number };

/** One page of the store plus the facets for its filters. Installed and best matches sort first. */
export function queryStore(entries: Entry[], q: StoreQuery) {
  const text = q.query.trim().toLowerCase();
  const visible = entries.filter((e) => q.unavailable || e.installable || e.installed);
  const matches = visible.filter(
    (e) =>
      (q.category === null || e.categories.includes(q.category)) &&
      (q.marketplace === null || e.marketplace === q.marketplace) &&
      (text === "" || `${e.displayName} ${e.name} ${e.description} ${e.marketplace} ${e.categories.join(" ")}`.toLowerCase().includes(text)),
  );
  // Name matches first, then listings with a description (Codex's remote ones are bare ids).
  const rank = (e: Entry) => (text !== "" && e.displayName.toLowerCase().startsWith(text) ? 0 : 2) + (e.description ? 0 : 1);
  matches.sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
  const count = (values: string[]) =>
    [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
      .map(([name, n]) => ({ name, count: n }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    items: matches.slice(q.offset, q.offset + q.limit),
    total: matches.length,
    hiddenUnavailable: entries.length - visible.length,
    categories: count(visible.flatMap((e) => e.categories)),
    marketplaces: count(visible.map((e) => e.marketplace).filter(Boolean)),
  };
}

const HEADER_AUTH = /Authorization header|OAuth fallback is disabled/i;
const statusOf = (glyph: string): McpStatus =>
  glyph === "✔" ? "connected" : glyph === "!" ? "needs-auth" : glyph === "✘" ? "failed" : "pending";

/** MCP servers and their auth state. Never keeps headers or env values. */
export function parseMcp(agent: Agent, stdout: string): McpServer[] {
  const base = { detail: null, hint: null, plugin: null, icon: null, login: false, logout: false, enable: false, disable: false };
  if (agent === "claude") {
    // "plugin:github:github: https://… (HTTP) - ✘ Failed to connect — HTTP 400: …"
    return plain(stdout)
      .split("\n")
      .map((line) => /^(.+?): (.*) - ([✔!✘⏸])\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(([, name, target, glyph, text]) => {
        const status = statusOf(glyph);
        const error = status === "failed" ? text.replace(/^Failed to connect\s*—?\s*/, "") : null;
        const http = /^https?:/.test(target);
        const header = error !== null && HEADER_AUTH.test(error);
        return {
          ...base,
          name,
          target: target.replace(/ \((HTTP|SSE|stdio)\)$/i, ""),
          status,
          detail: error ?? (status === "pending" ? text : null),
          hint: header
            ? "Signs in with a fixed Authorization header from its config (usually an environment variable), so logging in won't help. Fix that value, then check again."
            : null,
          plugin: /^plugin:([^:]+):/.exec(name)?.[1] ?? null,
          login: http && !header && status !== "pending",
          logout: http && status === "connected",
        };
      });
  }
  if (agent === "codex") {
    const rows: any[] = json(stdout);
    return rows.map((r) => {
      const auth = str(r.auth_status);
      const t = r.transport ?? {};
      const target = str(t.url) || str(t.command).split("/").pop() || "";
      const detail =
        auth === "o_auth" ? "Logged in (OAuth)" : auth === "bearer_token" ? `Token from $${str(t.bearer_token_env_var) || "env"}` : null;
      return {
        ...base,
        name: str(r.name),
        target,
        status: r.enabled === false ? "disabled" : auth === "not_logged_in" ? "needs-auth" : "configured",
        detail,
        login: auth === "not_logged_in" || auth === "o_auth",
        logout: auth === "o_auth",
      };
    });
  }
  if (agent === "cursor") {
    // "mobbin: requires_authentication" | "x: ready" | "y: not loaded (needs approval)" | "z: Error: …"
    return plain(stdout)
      .split("\n")
      .map((line) => /^(\S[^:]*): (.+)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(([, name, s]) => {
        const status: McpStatus =
          s === "ready" ? "connected" : s === "requires_authentication" ? "needs-auth" : s === "loading" ? "loading" : s === "disabled" ? "disabled" : s.startsWith("not loaded") ? "pending" : "failed";
        return {
          ...base,
          name,
          target: "",
          status,
          detail: status === "failed" ? s.replace(/^Error:\s*/, "") : status === "pending" ? "Needs approval" : null,
          login: status === "needs-auth",
          enable: status === "pending" || status === "disabled",
          disable: status !== "pending" && status !== "disabled",
        };
      });
  }
  // Devin: "  • name\n    URL: https://…" — no status in its CLI.
  const servers: McpServer[] = [];
  for (const line of plain(stdout).split("\n")) {
    const head = /^\s*•\s+(.+)$/.exec(line);
    if (head) servers.push({ ...base, name: head[1].trim(), target: "", status: "configured", login: true, logout: true });
    const target = /^\s+(?:URL|Command):\s+(.*)$/.exec(line);
    if (target && servers.length > 0) servers[servers.length - 1].target = target[1].trim().slice(0, 200);
  }
  return servers;
}

/** CLI or terminal output for the UI: bounded, with anything token-shaped masked. */
export function redact(text: string, max = 4000): string {
  return plain(text)
    .replace(/(bearer\s+)[^\s"']+/gi, "$1•••")
    .replace(/((?:token|secret|password|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1•••")
    .replace(/([?&#](?:code|access_token|id_token|refresh_token|token)=)[^&\s"']+/gi, "$1•••")
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-)[A-Za-z0-9_-]{8,}/g, "•••")
    .trim()
    .slice(-max);
}
