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
  browse: boolean; // search marketplace plugins and install one
  installSource: boolean; // install from a source (owner/repo, git URL, path)
  marketplaces: boolean; // list/add/remove/refresh marketplaces
};
export const FEATURES: Record<Agent, Features> = {
  claude: { plugins: true, toggle: true, update: true, uninstall: true, browse: true, installSource: false, marketplaces: true },
  codex: { plugins: true, toggle: false, update: false, uninstall: true, browse: true, installSource: false, marketplaces: true },
  cursor: { plugins: false, toggle: false, update: false, uninstall: false, browse: false, installSource: false, marketplaces: true },
  devin: { plugins: true, toggle: false, update: true, uninstall: true, browse: false, installSource: true, marketplaces: false },
};

export const NOTES: Partial<Record<Agent, string>> = {
  codex: "Codex's CLI can't enable, disable or update single plugins; refreshing a marketplace pulls its latest plugins.",
  cursor:
    "cursor-agent's CLI manages marketplaces only. Cursor installs plugins per account, from the Cursor app or dashboard.",
  devin:
    "Installs go to your Devin personal plugins, which sync to your account; the Devin CLI says a plugin whose source isn't reachable from the cloud (e.g. a local path) won't load in cloud sessions like bb's Devin Cloud threads. Devin has no plugin marketplace CLI.",
};

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
export type Listing = { id: string; name: string; source: string; description: string; installed: boolean };

export type Action =
  | { kind: "enable" | "disable" | "update" | "uninstall" | "install"; id: string }
  | { kind: "addMarketplace"; source: string }
  | { kind: "removeMarketplace" | "updateMarketplace"; name: string };

// Passed as argv (no shell), so the only risk is an option-looking value.
const arg = z.string().trim().min(1).max(500).regex(/^[^-\s][^\s]*$/, "Must be one word that doesn't start with -");
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["enable", "disable", "update", "uninstall", "install"]), id: arg }).strict(),
  z.object({ kind: z.literal("addMarketplace"), source: arg }).strict(),
  z.object({ kind: z.enum(["removeMarketplace", "updateMarketplace"]), name: arg }).strict(),
]);

/** Server → host: run one allowlisted agent CLI. */
export const hostContract = defineRpcContract({
  run: {
    input: z.object({ bin: z.enum(BINS), args: z.array(z.string().max(500)).max(16) }).strict(),
    output: z.object({ missing: z.boolean(), code: z.number().nullable(), stdout: z.string(), stderr: z.string() }),
  },
});

export const LIST = {
  plugins: { claude: ["plugin", "list", "--json"], codex: ["plugin", "list", "--json"], devin: ["plugins", "list"] },
  available: { claude: ["plugin", "list", "--json", "--available"], codex: ["plugin", "list", "--available", "--json"] },
  marketplaces: {
    claude: ["plugin", "marketplace", "list", "--json"],
    codex: ["plugin", "marketplace", "list", "--json"],
    cursor: ["plugin", "marketplace", "list", "--format", "json"],
  },
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
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const splitId = (id: string) => {
  const at = id.lastIndexOf("@");
  return at > 0 ? { name: id.slice(0, at), market: id.slice(at + 1) } : { name: id, market: "" };
};
const json = (stdout: string): any => JSON.parse(stdout);
// Strips ANSI colour codes some CLIs print even when piped.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

/** Marketplace plugins matching `query` (name, description or marketplace), at most `limit`. */
export function parseAvailable(agent: Agent, stdout: string, query: string, limit: number): { items: Listing[]; total: number } {
  const data = json(stdout);
  const installed = new Set<string>((data.installed ?? []).map((r: any) => str(r.id) || str(r.pluginId)));
  const rows: any[] = data.available ?? [];
  const q = query.trim().toLowerCase();
  const all = rows
    .map((r) => ({
      id: str(r.pluginId),
      name: str(r.name) || splitId(str(r.pluginId)).name,
      source: str(r.marketplaceName),
      description: str(r.description),
      installed: r.installed === true || installed.has(str(r.pluginId)),
    }))
    .filter((r) => r.id !== "" && (q === "" || `${r.name} ${r.source} ${r.description}`.toLowerCase().includes(q)));
  return { items: all.slice(0, limit), total: all.length };
}

/** CLI output for the UI: bounded, with anything token-shaped masked. */
export function redact(text: string): string {
  return plain(text)
    .replace(/(bearer\s+)[^\s"']+/gi, "$1•••")
    .replace(/((?:token|secret|password|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1•••")
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-)[A-Za-z0-9_-]{8,}/g, "•••")
    .trim()
    .slice(0, 4000);
}
