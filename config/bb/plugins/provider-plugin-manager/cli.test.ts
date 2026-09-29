// Run: node --experimental-strip-types cli.test.ts
// Fixtures are trimmed real outputs (claude 2.1.285, codex 0.157.1, cursor-agent 2026.07.23, devin 3000.11.3).
import assert from "node:assert/strict";
import { actionArgv, actionSchema, parseAvailable, parseMarketplaces, parsePlugins, redact } from "./cli.ts";

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
  installed: [{ pluginId: "ponytail@ponytail", name: "ponytail", marketplaceName: "ponytail", version: "1.0.0", enabled: true }],
  available: [
    { pluginId: "ponytail@ponytail", name: "ponytail", marketplaceName: "ponytail", description: "Be lazy", installed: true },
    { pluginId: "messages@openai-bundled", name: "messages", marketplaceName: "openai-bundled", description: "Chat", installed: false },
  ],
});
assert.deepEqual(parsePlugins("codex", codexList).map((p) => [p.id, p.source, p.enabled]), [["ponytail@ponytail", "ponytail", true]]);
const found = parseAvailable("codex", codexList, "CHAT", 10);
assert.deepEqual([found.total, found.items[0].id, found.items[0].installed], [1, "messages@openai-bundled", false]);
assert.equal(parseAvailable("codex", codexList, "", 1).total, 2);
assert.equal(parseAvailable("codex", codexList, "", 1).items.length, 1);
// Claude's available rows carry no installed flag; it comes from the installed list.
const claudeAvail = JSON.stringify({ installed: [{ id: "a@m" }], available: [{ pluginId: "a@m", name: "a", marketplaceName: "m" }] });
assert.equal(parseAvailable("claude", claudeAvail, "", 5).items[0].installed, true);

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

console.log("ok");
