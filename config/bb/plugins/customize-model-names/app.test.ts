// Run: node --experimental-strip-types app.test.ts
import assert from "node:assert/strict";
import {
  isVisible,
  matchesPattern,
  parseRenames,
  parseVisibleModels,
  renameLabel,
  rowNames,
  type RenameConfig,
} from "./rename.ts";

const gpt: RenameConfig = { gptStyle: true, renames: [] };
assert.equal(renameLabel("GPT-6-Astra", false, gpt), "GPT-6 Astra");
assert.equal(renameLabel("GPT-5.6-Sol", false, gpt), "GPT-5.6 Sol");
assert.equal(renameLabel("GPT-5.5", false, gpt), null);
assert.equal(renameLabel("6-Astra", true, gpt), "GPT-6 Astra");
assert.equal(renameLabel("5.5", true, gpt), "GPT-5.5");
assert.equal(renameLabel(" 5.6-Terra ", true, gpt), " GPT-5.6 Terra ");
assert.equal(renameLabel("5.5", false, gpt), null); // bare numbers only in picker
assert.equal(renameLabel("GPT-6 Astra", true, gpt), null); // idempotent
assert.equal(renameLabel("Opus 4.7", true, gpt), null);

const off: RenameConfig = { gptStyle: false, renames: [] };
assert.equal(renameLabel("6-Astra", true, off), null);

const custom: RenameConfig = {
  gptStyle: true,
  renames: [{ from: "6-Astra", to: "Astra" }, { from: "Opus 4.7", to: "Opus" }],
};
assert.equal(renameLabel("6-Astra", false, custom), "Astra"); // custom wins, anywhere
assert.equal(renameLabel("Opus 4.7", false, custom), "Opus");
assert.equal(renameLabel("5.5", true, custom), "GPT-5.5"); // GPT rule still applies

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
assert.deepEqual(rowNames("6-Astra", codex), ["6-Astra", "gpt-6-astra", "GPT-6-Astra"]);
assert.deepEqual(rowNames("5.5", codex), ["5.5", "gpt-5.5", "GPT-5.5"]);
assert.deepEqual(rowNames("Opus 5.5 alias", codex), ["Opus 5.5 alias"]);

assert.ok(isVisible(rowNames("6-Astra", codex), ["GPT-6*"])); // via display name / id
assert.ok(!isVisible(rowNames("5.5", codex), ["GPT-6*"]));
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
