// Run: node --experimental-strip-types relay.test.ts
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { collapseVersion, expandLevel, expandModel, expandTier, isLegacyId, matchRepo, priorityModels, RELAY_FLAG } from "./relay.ts";
import { relayCloudLaunches } from "./host.ts";
import { devinModelFromTitle, relabel } from "./labels.ts";
import { sessionUrl } from "./server.ts";

const repos = { id: "repos", currentValue: "", options: [{ value: "greptileai/dataset" }, { value: "acme/app" }] };
assert.equal(matchRepo([repos], "git@github.com:greptileai/dataset.git\n"), "greptileai/dataset");
assert.equal(matchRepo([repos], "https://github.com/Acme/App"), "acme/app");
assert.equal(matchRepo([repos], "https://github.com/ravern/dots.git"), null);
assert.equal(matchRepo([{ ...repos, currentValue: "acme/app" }], "https://github.com/greptileai/dataset"), null);

// Devin Cloud's tier toggle reads "Priority"; other providers' Fast mode is untouched.
assert.equal(relabel("Priority mode"), "Priority");
assert.equal(relabel("Devin Cloud: SWE-2 · High reasoning (Fast mode)"), "Devin Cloud: SWE-2 · High reasoning (Priority)");
assert.equal(relabel("Fast mode"), "Fast mode");
assert.equal(relabel("Codex: GPT-6 Sol · High reasoning (Fast mode)"), "Codex: GPT-6 Sol · High reasoning (Fast mode)");
assert.equal(relabel("Priority"), "Priority");
// The picker trigger's title names the picked Devin Cloud model; other providers' don't count.
assert.equal(devinModelFromTitle("Devin Cloud: SWE-2 · High reasoning (Priority)"), "SWE-2");
assert.equal(devinModelFromTitle("Devin Cloud: SWE-2 · High reasoning (Fast mode)"), "SWE-2");
assert.equal(devinModelFromTitle("Devin Cloud: Fusion"), "Fusion");
assert.equal(devinModelFromTitle("Devin Cloud: GPT-5.6 Sol Promo (Priority)"), "GPT-5.6 Sol Promo");
assert.equal(devinModelFromTitle("Codex: GPT-6 Sol · High reasoning (Fast mode)"), null);

assert.equal(sessionUrl("devin-97eee97c"), "https://app.devin.ai/sessions/97eee97c");
assert.equal(sessionUrl("statuesque-loaf"), null);

const request = { params: { options: { providerOptions: { acpLaunchSpec: { command: "devin", args: ["acp", "--cloud"], env: {} } } } } };
relayCloudLaunches(request);
const spec = request.params.options.providerOptions.acpLaunchSpec;
assert.equal(spec.command, process.execPath);
assert.deepEqual(spec.args.slice(1), [RELAY_FLAG, "devin", "acp", "--cloud"]);
relayCloudLaunches(request); // idempotent
assert.equal(spec.args.filter((a) => a === RELAY_FLAG).length, 1);

// Devin Cloud's model option as advertised (trimmed): levels baked into ids and names.
const version = (currentValue: string) => ({
  id: "devin_version",
  name: "Devin version",
  type: "select",
  currentValue,
  options: [
    { value: "devin-auto", name: "Fusion" },
    { value: "devin_lite", name: "Lite" },
    { value: "devin-swe-2-low", name: "SWE-2 Medium" },
    { value: "devin-swe-2-high", name: "SWE-2 High" },
    { value: "devin-swe-2-max", name: "SWE-2 Max" },
    { value: "devin-swe-2-priority-low", name: "SWE-2 Medium (Priority)" },
    { value: "devin-swe-2-priority-high", name: "SWE-2 High (Priority)" },
    { value: "devin-swe-2-priority-max", name: "SWE-2 Max (Priority)" },
    { value: "devin-gpt-5-6", name: "GPT-5.6 Sol Promo" },
  ],
});

// Family collapse: one model per family (priority folds in), its levels with Devin's labels,
// and a priority switch (bb's service tier option) for families with a priority tier.
const [model, thought, tier] = collapseVersion(version("devin-swe-2-priority-high"));
assert.equal(model.category, "model");
assert.deepEqual(model.options, [
  { value: "devin-auto", name: "Fusion" },
  { value: "devin_lite", name: "Lite" },
  { value: "devin-swe-2", name: "SWE-2" },
  { value: "devin-gpt-5-6", name: "GPT-5.6 Sol Promo" },
]);
assert.equal(model.currentValue, "devin-swe-2");
assert.equal(thought.category, "thought_level");
assert.equal(thought.currentValue, "high");
assert.deepEqual(thought.options, [
  { value: "medium", name: "Medium" },
  { value: "high", name: "High" },
  { value: "max", name: "Max" },
]);
assert.deepEqual([tier.id, tier.currentValue], ["fast", "true"]);
assert.equal(collapseVersion(version("devin-swe-2-low"))[2].currentValue, "false");

// Only families with a priority tier offer the Priority switch (by picker name).
assert.deepEqual(priorityModels(version("devin-auto")), ["SWE-2"]);
assert.deepEqual(priorityModels({ options: version("").options.filter((o) => !o.value.includes("priority")) }), []);

// No levels: an empty thought_level (bb reads it as no reasoning efforts) and no priority switch.
const noLevels = collapseVersion(version("devin-auto"));
assert.equal(noLevels[0].currentValue, "devin-auto");
assert.deepEqual(noLevels[1].options, []);
assert.equal(noLevels.length, 2);

// Picks back to real ids: a family defaults to Medium without priority and keeps the
// session's level and tier; levels map by label and keep the tier; the tier keeps the level.
assert.equal(expandModel(version("devin-auto"), "devin-swe-2"), "devin-swe-2-low");
assert.equal(expandModel(version("devin-swe-2-priority-max"), "devin-swe-2"), "devin-swe-2-priority-max");
assert.equal(expandModel(version("devin-swe-2-max"), "devin_lite"), "devin_lite");
assert.equal(expandLevel(version("devin-swe-2-low"), "high"), "devin-swe-2-high");
assert.equal(expandLevel(version("devin-swe-2-priority-high"), "medium"), "devin-swe-2-priority-low");
assert.equal(expandLevel(version("devin-auto"), "high"), null);
assert.equal(expandTier(version("devin-swe-2-high"), "true"), "devin-swe-2-priority-high");
assert.equal(expandTier(version("devin-swe-2-priority-max"), "false"), "devin-swe-2-max");
assert.equal(expandTier(version("devin-auto"), "true"), null);

// Legacy ids (threads from before the collapse) pass through and are recognised.
assert.equal(expandModel(version("devin-auto"), "devin-swe-2-high"), "devin-swe-2-high");
assert.equal(expandModel(version("devin-auto"), "devin-swe-2-priority-high"), "devin-swe-2-priority-high");
assert.equal(isLegacyId(version("devin-auto"), "devin-swe-2-priority-high"), true);
assert.equal(isLegacyId(version("devin-auto"), "devin-swe-2"), false);

// End to end: a fake cloud agent behind the relay.
const workspace = mkdtempSync(join(tmpdir(), "devin-relay-"));
execFileSync("git", ["init", "-q", workspace]);
execFileSync("git", ["-C", workspace, "remote", "add", "origin", "git@github.com:acme/app.git"]);
const fakeAgent = `
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const state = { repos: "", devin_version: "devin-auto" };
  const options = () => [
    { id: "repos", currentValue: state.repos, options: [{ value: "acme/app" }] },
    { id: "devin_version", currentValue: state.devin_version, options: ${JSON.stringify(version("").options)} },
  ];
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
  rl.on("line", (line) => {
    const m = JSON.parse(line);
    if (m.method === "session/set_config_option") state[m.params.configId] = m.params.value;
    if (m.method === "session/prompt") {
      // Devin Cloud's order on follow-ups: announce, answer the prompt, then deliver the reply.
      const update = (u) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "devin-abc", update: u } });
      update({ sessionUpdate: "session_info_update", _meta: { "cognition.ai/isTyping": true } });
      send({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } });
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late" } });
      return;
    }
    const result = m.method === "session/new" ? { sessionId: "devin-abc", configOptions: options() } : { configOptions: options(), got: m.params };
    send({ jsonrpc: "2.0", id: m.id, result });
  });`;
const relay = spawn(process.execPath, ["--experimental-strip-types", "-e", `import("./relay.ts").then((r) => r.runRelay(process.argv.slice(1)))`, process.execPath, "-e", fakeAgent], {
  cwd: import.meta.dirname,
  stdio: ["pipe", "pipe", "inherit"],
});
const replies = createInterface({ input: relay.stdout })[Symbol.asyncIterator]();
const next = async () => JSON.parse((await replies.next()).value);
let id = 0;
const send = (method: string, params: object) => relay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
const option = (reply: any, optionId: string) => reply.result.configOptions.find((o: any) => o.id === optionId);

// The repo is set before bb sees session/new; the model option arrives collapsed.
send("session/new", { cwd: workspace });
const created = await next();
assert.equal(option(created, "repos").currentValue, "acme/app");
assert.equal(option(created, "devin_version").category, "model");
assert.deepEqual(option(created, "thought_level").options, []);

// Picking SWE-2 + High + priority launches devin-swe-2-priority-high.
send("session/set_config_option", { sessionId: "devin-abc", configId: "devin_version", value: "devin-swe-2" });
const picked = await next();
assert.equal(picked.result.got.value, "devin-swe-2-low");
assert.equal(option(picked, "devin_version").currentValue, "devin-swe-2");
send("session/set_config_option", { sessionId: "devin-abc", configId: "thought_level", value: "high" });
const leveled = await next();
assert.deepEqual([leveled.result.got.configId, leveled.result.got.value], ["devin_version", "devin-swe-2-high"]);
assert.equal(option(leveled, "thought_level").currentValue, "high");
send("session/set_config_option", { sessionId: "devin-abc", configId: "fast", value: "true" });
const prioritized = await next();
assert.deepEqual([prioritized.result.got.configId, prioritized.result.got.value], ["devin_version", "devin-swe-2-priority-high"]);
assert.equal(option(prioritized, "fast").currentValue, "true");

// A legacy id keeps its baked-in level and tier: the bridge's follow-up picks are answered by the relay.
send("session/set_config_option", { sessionId: "devin-abc", configId: "devin_version", value: "devin-swe-2-priority-max" });
assert.equal((await next()).result.got.value, "devin-swe-2-priority-max");
send("session/set_config_option", { sessionId: "devin-abc", configId: "thought_level", value: "medium" });
const kept = await next();
assert.equal(kept.result.got, undefined); // never reached the agent
assert.equal(option(kept, "thought_level").currentValue, "max");
send("session/set_config_option", { sessionId: "devin-abc", configId: "fast", value: "false" });
const keptTier = await next();
assert.equal(keptTier.result.got, undefined);
assert.deepEqual([option(keptTier, "devin_version").currentValue, option(keptTier, "fast").currentValue], ["devin-swe-2", "true"]);

// The announced reply lands inside the turn; the relay's own requests never reach bb.
send("session/prompt", { sessionId: "devin-abc" });
assert.equal((await next()).params.update.sessionUpdate, "session_info_update");
assert.equal((await next()).params.update.content.text, "late");
assert.equal((await next()).result.stopReason, "end_turn");
relay.kill();
console.log("ok");
