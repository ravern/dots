// Run: node --experimental-strip-types cli.test.ts
// Fixtures are trimmed real outputs (claude 2.1.285, codex 0.157.1, cursor-agent 2026.07.23, devin 3000.11.3).
import assert from "node:assert/strict";
import { hider, isOurPage, sidebarRest } from "./sidebar.ts";
import { actionArgv, actionSchema, claudePluginDirs, codexManifestPaths, dirIcon, manifestIcon, parseCatalog, parseDevinCatalog, parseMarketplaces, parseMcp, parsePlugins, queryStore, redact, shellQuote } from "./cli.ts";

const claudeList = JSON.stringify([
  {
    id: "github@claude-plugins-official",
    version: "751e8d02bf56",
    scope: "user",
    enabled: true,
    mcpServers: { github: { type: "http", headers: { Authorization: "Bearer ghp_abcdefghijklmnop" } } },
  },
  { id: "greptile@claude-plugins-official", version: "unknown", scope: "project", enabled: false, projectPath: "/w/cli" },
]);
const claude = parsePlugins("claude", claudeList);
assert.deepEqual(claude[0], {
  id: "github@claude-plugins-official",
  name: "github",
  source: "claude-plugins-official",
  version: "751e8d02bf56",
  enabled: true,
  scope: "user",
  actionable: true,
  note: null,
});
assert.equal(claude[1].version, null);
assert.equal(claude[1].actionable, false);
assert.equal(claude[1].note, "project: /w/cli");
assert.ok(!JSON.stringify(claude).includes("ghp_"), "MCP auth headers never reach a row");

const codexList = JSON.stringify({
  installed: [{ pluginId: "ponytail@ponytail", name: "ponytail", marketplaceName: "ponytail", version: "1.0.0", enabled: true, installed: true }],
  available: [
    {
      pluginId: "messages@openai-bundled",
      name: "messages",
      marketplaceName: "openai-bundled",
      installed: false,
      installPolicy: "AVAILABLE",
      source: { source: "local", path: "/b/messages" },
    },
    { pluginId: "app-6a05@openai-curated-remote", name: "app-6a05", marketplaceName: "openai-curated-remote", installPolicy: "NOT_AVAILABLE", source: { source: "remote", id: "x" } },
  ],
});
assert.deepEqual(parsePlugins("codex", codexList).map((p) => [p.id, p.source, p.enabled]), [["ponytail@ponytail", "ponytail", true]]);
assert.deepEqual(codexManifestPaths(codexList).sort(), ["/b/messages/.codex-plugin/plugin.json", "~/.codex/plugins/cache/ponytail/ponytail/1.0.0/.codex-plugin/plugin.json"]);
const codexCatalog = parseCatalog("codex", codexList, {
  "/b/messages/.codex-plugin/plugin.json": {
    interface: { displayName: "Messages", shortDescription: "Chat on this Mac", category: "Productivity", composerIcon: "./assets/icon.png", logo: "./assets/logo.png" },
  },
  "~/.codex/plugins/cache/ponytail/ponytail/1.0.0/.codex-plugin/plugin.json": { interface: { logo: "assets/logo.png" } },
});
const messages = codexCatalog.find((e) => e.id === "messages@openai-bundled")!;
assert.deepEqual([messages.displayName, messages.description, messages.categories, messages.installable], ["Messages", "Chat on this Mac", ["Productivity"], true]);
assert.equal(codexCatalog.find((e) => e.name === "ponytail")!.installed, true);
// Icons: the manifest's small composerIcon first; installed plugins read Codex's cache.
assert.deepEqual(messages.icon, { base: "/b/messages", rel: "assets/icon.png" });
assert.deepEqual(codexCatalog.find((e) => e.name === "ponytail")!.icon, { base: "~/.codex/plugins/cache/ponytail/ponytail/1.0.0", rel: "assets/logo.png" });
assert.equal(codexCatalog.find((e) => e.name === "app-6a05")!.icon, null);
assert.ok(codexManifestPaths(codexList).includes("~/.codex/plugins/cache/ponytail/ponytail/1.0.0/.codex-plugin/plugin.json"));
// Codex's remote catalog is mostly NOT_AVAILABLE: hidden unless asked for.
const q = { query: "", category: null, marketplace: null, unavailable: false, offset: 0, limit: 1 };
const page1 = queryStore(codexCatalog, q);
assert.deepEqual([page1.total, page1.items.length, page1.hiddenUnavailable], [2, 1, 1]);
assert.equal(queryStore(codexCatalog, { ...q, unavailable: true, limit: 10 }).total, 3);
assert.deepEqual(queryStore(codexCatalog, { ...q, query: "chat", limit: 10 }).items.map((e) => e.id), ["messages@openai-bundled"]);
assert.deepEqual(queryStore(codexCatalog, { ...q, limit: 10 }).categories, [{ name: "Productivity", count: 1 }]);

// Claude: listings from each marketplace's manifest; installed comes from the installed list.
const claudeAvail = JSON.stringify({
  installed: [{ id: "a@m" }],
  available: [{ pluginId: "b@m", name: "b", marketplaceName: "m", description: "Bee" }, { pluginId: "c@other", name: "c", marketplaceName: "other" }],
});
const claudeManifests = {
  m: { plugins: [{ name: "a", description: "Ay", category: "development", author: { name: "Anthropic" } }, { name: "b-tools", category: "database", source: "./plugins/b-tools" }] },
  other: null,
};
const claudeWithPath = JSON.stringify({ ...JSON.parse(claudeAvail), installed: [{ id: "a@m", installPath: "/cache/m/a/1.0" }] });
const claudeDirs = claudePluginDirs(claudeWithPath, claudeManifests, { m: "/mk/m" });
assert.deepEqual(claudeDirs, { "b-tools@m": "/mk/m/plugins/b-tools", "a@m": "/cache/m/a/1.0" });
// Claude manifests name no icon; the plugin's Codex or Cursor manifest can.
const claudeCatalog = parseCatalog("claude", claudeAvail, claudeManifests, {
  dirs: claudeDirs,
  read: { "/cache/m/a/1.0/.cursor-plugin/plugin.json": { logo: "assets/a.svg" }, "/mk/m/plugins/b-tools/.claude-plugin/plugin.json": { name: "b-tools" } },
});
assert.deepEqual(claudeCatalog.find((e) => e.id === "a@m")!.icon, { base: "/cache/m/a/1.0", rel: "assets/a.svg" });
assert.equal(claudeCatalog.find((e) => e.id === "b-tools@m")!.icon, null);
assert.deepEqual(
  claudeCatalog.map((e) => [e.id, e.installed, e.categories[0] ?? null]),
  [
    ["a@m", true, "Development"],
    ["b-tools@m", false, "Database"],
    ["b@m", false, null],
    ["c@other", false, null],
  ],
);
assert.equal(claudeCatalog[0].author, "Anthropic");

const devinCatalog = parseDevinCatalog(
  { notion: { name: "notion", displayName: "Notion", description: "Pages", keywords: ["Essentials", "Productivity"], mcpServers: { notion: {} } }, broken: null },
  new Set(["notion"]),
);
assert.deepEqual(devinCatalog[0], {
  id: "CognitionAI/devin-marketplace#plugins/notion",
  name: "notion",
  displayName: "Notion",
  description: "Pages",
  marketplace: "devin-marketplace",
  categories: ["Essentials", "Productivity"],
  author: null,
  homepage: null,
  installed: true,
  installable: true,
  mcpServers: ["notion"],
  icon: null,
});
assert.deepEqual(
  parseDevinCatalog({ slack: { name: "slack", logo: "logo.svg" }, "..": { logo: "logo.svg" } }, new Set()).map((e) => e.icon),
  [{ base: "@devin/slack", rel: "logo.svg" }, null],
);

// Icon fields: https URLs pass through; local paths must stay inside the plugin dir and be images.
assert.deepEqual(manifestIcon({ logo: "https://cdn.test/x.png" }, "/p"), { url: "https://cdn.test/x.png" });
for (const bad of ["http://cdn.test/x.png", "../x.png", "a/../../x.png", "/etc/x.png", "file:///x.png", "data:image/png;base64,AA", "logo.txt", "a\\..\\x.png"]) {
  assert.equal(manifestIcon({ logo: bad }, "/p"), null, bad);
}
assert.deepEqual(dirIcon("/p", { "/p/.codex-plugin/plugin.json": { interface: { logo: "./l.webp" } } }), { base: "/p", rel: "l.webp" });
assert.equal(dirIcon(undefined, {}), null);
assert.equal(devinCatalog[1].displayName, "Broken");

const devin = parsePlugins("devin", "Installed plugins\n\n  \x1b[1m•\x1b[0m notion unversioned\n  • review 1.2.0 [blocked by org policy]\n");
assert.deepEqual(
  devin.map((p) => [p.id, p.version, p.note]),
  [
    ["notion", null, null],
    ["review", "1.2.0", "[blocked by org policy]"],
  ],
);

const codexMarkets = JSON.stringify({
  marketplaces: [
    { name: "personal", root: "/Users/me" },
    { name: "openai-bundled", root: "/x", marketplaceSource: { sourceType: "local", source: "/x" } },
    { name: "ponytail", root: "/y", marketplaceSource: { sourceType: "git", source: "https://github.com/D/ponytail.git" } },
  ],
});
assert.deepEqual(
  parseMarketplaces("codex", codexMarkets).map((m) => [m.name, m.removable, m.refreshable]),
  [
    ["personal", false, false],
    ["openai-bundled", false, false],
    ["ponytail", true, true],
  ],
);
const cursorMarkets = JSON.stringify([
  { name: "cursor-public", gitUrl: "", displayName: "Cursor Plugin Marketplace", scope: "global" },
  { name: "ponytail", gitUrl: "https://github.com/D/ponytail", scope: "user" },
]);
assert.deepEqual(parseMarketplaces("cursor", cursorMarkets).map((m) => [m.source, m.removable]), [
  ["Cursor Plugin Marketplace", false],
  ["https://github.com/D/ponytail", true],
]);
assert.equal(parseMarketplaces("claude", JSON.stringify([{ name: "p", source: "github", repo: "D/ponytail" }]))[0].source, "D/ponytail");

// Only supported operations produce argv.
assert.deepEqual(actionArgv("claude", { kind: "disable", id: "a@m" }), ["plugin", "disable", "a@m", "--scope", "user"]);
assert.equal(actionArgv("codex", { kind: "disable", id: "a@m" }), null);
assert.equal(actionArgv("cursor", { kind: "install", id: "a" }), null);
assert.deepEqual(actionArgv("codex", { kind: "updateMarketplace", name: "p" }), ["plugin", "marketplace", "upgrade", "p"]);
assert.deepEqual(actionArgv("devin", { kind: "uninstall", id: "notion" }), ["plugins", "remove", "notion", "--yes"]);
assert.equal(actionArgv("devin", { kind: "addMarketplace", source: "x/y" }), null);
assert.equal(actionSchema.safeParse({ kind: "install", id: "--scope=project" }).success, false, "no option injection");
assert.equal(actionSchema.safeParse({ kind: "install", id: "a b" }).success, false);

assert.equal(redact('Authorization: Bearer abc123 token="xyz" sk-abcdefghijkl'), "Authorization: ••• ••• token=\"•••\" •••");

// MCP servers (real line shapes).
const claudeMcp = parseMcp(
  "claude",
  [
    "Checking MCP server health…",
    "",
    "claude.ai Vanta: https://mcp.vanta.com/mcp - ! Needs authentication",
    "plugin:greptile:greptile: https://api.greptile.com/mcp (HTTP) - ✔ Connected",
    'plugin:braintrust:braintrust: https://api.braintrust.dev/mcp (HTTP) - ✘ Failed to connect — Server rejected the configured Authorization header (HTTP 401). OAuth fallback is disabled when headers.Authorization is set.',
    "plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✘ Failed to connect — HTTP 400: Error POSTing to endpoint: bad request: Authorization header is badly formatted",
    "local: npx -y some-server --flag - ✔ Connected",
  ].join("\n"),
);
assert.deepEqual(
  claudeMcp.map((s) => [s.name, s.status, s.plugin, s.login, s.logout, s.hint !== null]),
  [
    ["claude.ai Vanta", "needs-auth", null, true, false, false],
    ["plugin:greptile:greptile", "connected", "greptile", true, true, false],
    ["plugin:braintrust:braintrust", "failed", "braintrust", false, false, true],
    ["plugin:github:github", "failed", "github", false, false, true],
    ["local", "connected", null, false, false, false],
  ],
);
assert.equal(claudeMcp[1].target, "https://api.greptile.com/mcp");
assert.match(claudeMcp[3].detail!, /^HTTP 400/);

const codexMcp = parseMcp(
  "codex",
  JSON.stringify([
    { name: "greptile", enabled: true, transport: { type: "streamable_http", url: "https://api.greptile.com/mcp", http_headers: { Authorization: "Bearer sk-secretsecret" } }, auth_status: "not_logged_in" },
    { name: "braintrust", enabled: true, transport: { url: "https://api.braintrust.dev/mcp", bearer_token_env_var: "BRAINTRUST_API_KEY" }, auth_status: "bearer_token" },
    { name: "Mintlify Admin", enabled: true, transport: { url: "https://mcp.mintlify.com" }, auth_status: "o_auth" },
    { name: "codex_app", enabled: false, transport: { type: "stdio", command: "/x/launch", env: { SECRET: "v" } }, auth_status: "unsupported" },
  ]),
);
assert.deepEqual(
  codexMcp.map((s) => [s.name, s.status, s.login, s.logout, s.detail]),
  [
    ["greptile", "needs-auth", true, false, null],
    ["braintrust", "configured", false, false, "Token from $BRAINTRUST_API_KEY"],
    ["Mintlify Admin", "configured", true, true, "Logged in (OAuth)"],
    ["codex_app", "disabled", false, false, null],
  ],
);
assert.ok(!JSON.stringify(codexMcp).includes("secret"), "headers and env never reach a row");

const cursorMcp = parseMcp("cursor", "mobbin: \x1b[33mrequires_authentication\x1b[39m\nx: ready\ny: not loaded (needs approval)\nz: Error: spawn ENOENT\n");
assert.deepEqual(
  cursorMcp.map((s) => [s.name, s.status, s.login, s.enable, s.disable, s.detail]),
  [
    ["mobbin", "needs-auth", true, false, true, null],
    ["x", "connected", false, false, true, null],
    ["y", "pending", false, true, false, "Needs approval"],
    ["z", "failed", false, false, true, "spawn ENOENT"],
  ],
);
const devinMcp = parseMcp("devin", "Configured MCP servers:\n\n  • aws-core\n    Command: uvx mcp-proxy\n\n  • notion\n    URL: https://mcp.notion.com/mcp\n");
assert.deepEqual(devinMcp.map((s) => [s.name, s.target, s.login]), [
  ["aws-core", "uvx mcp-proxy", true],
  ["notion", "https://mcp.notion.com/mcp", true],
]);
assert.deepEqual(actionArgv("cursor", { kind: "mcpEnable", name: "y" }), ["mcp", "enable", "y"]);
assert.equal(actionArgv("codex", { kind: "mcpEnable", name: "y" }), null);
assert.equal(actionSchema.safeParse({ kind: "mcpLogout", name: "claude.ai Linear" }).success, true, "server names may have spaces");
assert.equal(actionSchema.safeParse({ kind: "mcpLogout", name: "-x" }).success, false);
assert.equal(shellQuote("claude.ai Linear"), "'claude.ai Linear'");
assert.equal(shellQuote("it's"), "'it'\\''s'");
assert.equal(shellQuote("plugin:github:github"), "plugin:github:github");
assert.equal(redact("open https://x.test/cb?code=abc123&state=s"), "open https://x.test/cb?code=•••&state=s");

// Sidebar: route predicate, which parts get hidden, and exact restore. A tiny fake DOM with
// attribute selectors is enough for the selectors sidebar.ts uses.
class El {
  parentElement: El | null = null;
  children: El[] = [];
  style = { display: "" };
  attrs: Record<string, string>;
  constructor(attrs: Record<string, string> = {}, kids: El[] = []) {
    this.attrs = attrs;
    for (const k of kids) (k.parentElement = this), this.children.push(k);
  }
  matches(sel: string) {
    return sel.split(",").some((one) => {
      const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(one.trim());
      return m !== null && this.attrs[m[1]] === m[2];
    });
  }
  closest(sel: string): El | null {
    for (let e: El | null = this; e; e = e.parentElement) if (e.matches(sel)) return e;
    return null;
  }
  *all(): Generator<El> {
    for (const c of this.children) yield c, yield* c.all();
  }
  querySelectorAll(sel: string) {
    return [...this.all()].filter((e) => e.matches(sel));
  }
  contains(o: El | null) {
    for (let e = o; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
}
assert.equal(isOurPage("provider-plugin-manager/provider-plugins", "provider-plugin-manager", "provider-plugins"), true);
assert.equal(isOurPage("__bb__/new-thread", "provider-plugin-manager", "provider-plugins"), false);
assert.equal(isOurPage(null, "provider-plugin-manager", "provider-plugins"), false);

const nav = new El();
const group = new El({ "data-sidebar": "content" }); // nested inside the thread list: not hidden on its own
const threads = new El({ "data-sidebar": "content" }, [group]);
const footer = new El({ "data-sidebar": "footer" });
new El({ "data-sidebar": "sidebar" }, [new El({ "data-testid": "app-sidebar-top-reserve-row" }), new El({}, [nav]), threads, footer]);
assert.deepEqual(sidebarRest(nav as any), [threads, footer]);
// Mobile drawer body works the same.
const mobileNav = new El();
new El({ "data-testid": "app-sidebar-body" }, [mobileNav, new El({ "data-sidebar": "content" }), new El({ "data-sidebar": "footer" })]);
assert.equal(sidebarRest(mobileNav as any)?.length, 2);
// Fail safe: anything unexpected hides nothing.
assert.equal(sidebarRest(new El() as any), null, "not in a sidebar");
const noFooterNav = new El();
new El({ "data-sidebar": "sidebar" }, [noFooterNav, new El({ "data-sidebar": "content" })]);
assert.equal(sidebarRest(noFooterNav as any), null, "footer missing");
const insideNav = new El();
new El({ "data-sidebar": "sidebar" }, [new El({ "data-sidebar": "content" }, [insideNav]), new El({ "data-sidebar": "footer" })]);
assert.equal(sidebarRest(insideNav as any), null, "never hide the region holding our rows");

threads.style.display = "flex";
const h = hider();
h.hide([threads, footer] as any);
h.hide([threads] as any); // again: keeps the original display
assert.deepEqual([threads.style.display, footer.style.display], ["none", "none"]);
footer.style.display = "block"; // bb changed it meanwhile
h.restore();
assert.deepEqual([threads.style.display, footer.style.display], ["flex", "block"]);
h.restore(); // idempotent
assert.equal(threads.style.display, "flex");

console.log("ok");
