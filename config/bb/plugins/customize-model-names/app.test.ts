// Run: node --experimental-strip-types app.test.ts
import assert from "node:assert/strict";
import {
  isVisible,
  matchesPattern,
  parseRenames,
  parseVisibleModels,
  providerFromTitle,
  renameLabel,
  rowNames,
  type RenameConfig,
} from "./rename.ts";

const config: RenameConfig = {
  renames: [
    { from: "GPT-6-Sol", to: "GPT-6 Sol" },
    { from: "6-Sol", to: "GPT-6 Sol" },
    { from: "Opus 4.7", to: "" },
  ],
};
assert.equal(renameLabel("GPT-6-Sol", config), "GPT-6 Sol");
assert.equal(renameLabel(" 6-Sol ", config), " GPT-6 Sol "); // keeps surrounding whitespace
assert.equal(renameLabel("Opus 4.7", config), ""); // empty "to" hides
assert.equal(renameLabel("GPT-6 Sol", config), null); // idempotent
assert.equal(renameLabel("6-Sol extra", config), null); // exact only
assert.equal(renameLabel("5.5", config), null);

assert.deepEqual(parseRenames("not json"), []);
assert.deepEqual(parseRenames('[{"from":"a","to":"b"},{"from":""},7]'), [{ from: "a", to: "b" }]);

assert.ok(matchesPattern("Opus 5.5", "opus 5.5"));
assert.ok(!matchesPattern("Opus 5.5 alias", "Opus 5.5")); // exact without *
assert.ok(matchesPattern("gpt-6-astra", "GPT-6*"));
assert.ok(!matchesPattern("GPT-5.6-Sol", "GPT-6*"));
assert.ok(matchesPattern("anything", "*"));

const codex = [
  { id: "gpt-6-astra", displayName: "GPT-6-Astra" },
  { id: "gpt-5.5", displayName: "GPT-5.5" },
];
const none: RenameConfig = { renames: [] };
assert.deepEqual(rowNames("6-Astra", codex, none), ["6-Astra", "gpt-6-astra", "GPT-6-Astra"]);
assert.deepEqual(rowNames("5.5", codex, none), ["5.5", "gpt-5.5", "GPT-5.5"]);
assert.deepEqual(rowNames("Opus 5.5 alias", codex, none), ["Opus 5.5 alias"]);

assert.ok(isVisible(rowNames("6-Astra", codex, none), ["GPT-6*"])); // via display name / id
assert.ok(!isVisible(rowNames("5.5", codex, none), ["GPT-6*"]));

// Model list failed to load: the renamed label still matches.
const astra: RenameConfig = { renames: [{ from: "6-Astra", to: "GPT-6 Astra" }] };
assert.deepEqual(rowNames("6-Astra", [], astra), ["6-Astra", "GPT-6 Astra"]);
assert.ok(isVisible(rowNames("6-Astra", [], astra), ["GPT-6*"]));
assert.ok(!isVisible(rowNames("6-Astra", [], none), ["GPT-6*"]));
assert.ok(isVisible(["Sonnet 5"], undefined)); // no list: show all
assert.ok(isVisible(["Sonnet 5"], []));
assert.ok(isVisible(["claude-fable-5-1"], ["claude-fable-5-1"])); // by id
assert.ok(!isVisible(["Sonnet 5", "claude-sonnet-5"], ["Opus 5.5", "Fable 5.1"]));

assert.deepEqual(parseVisibleModels("nope"), {});
assert.deepEqual(parseVisibleModels("[]"), {});
assert.deepEqual(
  parseVisibleModels('{"codex":[" GPT-6* ",""],"pi":[],"x":"y","claude-code":["Opus 5.5",3]}'),
  { codex: ["GPT-6*"], "claude-code": ["Opus 5.5"] },
);
console.log("ok");

{
  const providers = [{ displayName: "Claude" }, { displayName: "Claude Code" }, { displayName: "Cursor" }];
  assert.equal(providerFromTitle("Cursor: Grok 4.7 · High reasoning (Fast mode)", providers)?.displayName, "Cursor");
  assert.equal(providerFromTitle("Claude Code: Opus 5.5 (Fast mode)", providers)?.displayName, "Claude Code");
  assert.equal(providerFromTitle("Codex: GPT-6", providers), null);
}
