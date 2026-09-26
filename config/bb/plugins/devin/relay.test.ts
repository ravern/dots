// Run: node --experimental-strip-types relay.test.ts
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { matchRepo, RELAY_FLAG } from "./relay.ts";
import { relayCloudLaunches } from "./host.ts";
import { sessionUrl } from "./server.ts";

const repos = { id: "repos", currentValue: "", options: [{ value: "greptileai/dataset" }, { value: "acme/app" }] };
assert.equal(matchRepo([repos], "git@github.com:greptileai/dataset.git\n"), "greptileai/dataset");
assert.equal(matchRepo([repos], "https://github.com/Acme/App"), "acme/app");
assert.equal(matchRepo([repos], "https://github.com/ravern/dots.git"), null);
assert.equal(matchRepo([{ ...repos, currentValue: "acme/app" }], "https://github.com/greptileai/dataset"), null);

assert.equal(sessionUrl("devin-97eee97c"), "https://app.devin.ai/sessions/97eee97c");
assert.equal(sessionUrl("statuesque-loaf"), null);

const request = { params: { options: { providerOptions: { acpLaunchSpec: { command: "devin", args: ["acp", "--cloud"], env: {} } } } } };
relayCloudLaunches(request);
const spec = request.params.options.providerOptions.acpLaunchSpec;
assert.equal(spec.command, process.execPath);
assert.deepEqual(spec.args.slice(1), [RELAY_FLAG, "devin", "acp", "--cloud"]);
relayCloudLaunches(request); // idempotent
assert.equal(spec.args.filter((a) => a === RELAY_FLAG).length, 1);

// End to end: a fake cloud agent behind the relay. The relay must set the repo
// before bb sees session/new, and tag devin_version as the model option.
const workspace = mkdtempSync(join(tmpdir(), "devin-relay-"));
execFileSync("git", ["init", "-q", workspace]);
execFileSync("git", ["-C", workspace, "remote", "add", "origin", "git@github.com:acme/app.git"]);
const fakeAgent = `
  const rl = require("node:readline").createInterface({ input: process.stdin });
  let repo = "";
  const options = () => [{ id: "repos", currentValue: repo, options: [{ value: "acme/app" }] }, { id: "devin_version", options: [] }];
  rl.on("line", (line) => {
    const m = JSON.parse(line);
    if (m.method === "session/set_config_option") repo = m.params.value;
    if (m.method === "session/prompt") {
      // Devin Cloud's order on follow-ups: announce, answer the prompt, then deliver the reply.
      const update = (u) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "devin-abc", update: u } }) + "\\n");
      update({ sessionUpdate: "session_info_update", _meta: { "cognition.ai/isTyping": true } });
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } }) + "\\n");
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late" } });
      return;
    }
    const result = m.method === "session/new" ? { sessionId: "devin-abc", configOptions: options() } : { configOptions: options(), seen: m.method };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  });`;
const relay = spawn(process.execPath, ["--experimental-strip-types", "-e", `import("./relay.ts").then((r) => r.runRelay(process.argv.slice(1)))`, process.execPath, "-e", fakeAgent], {
  cwd: import.meta.dirname,
  stdio: ["pipe", "pipe", "inherit"],
});
const replies = createInterface({ input: relay.stdout })[Symbol.asyncIterator]();
const next = async () => JSON.parse((await replies.next()).value);
relay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: workspace } }) + "\n");
const created = await next();
assert.equal(created.id, 1);
assert.equal(created.result.configOptions.find((o: any) => o.id === "repos").currentValue, "acme/app");
assert.equal(created.result.configOptions.find((o: any) => o.id === "devin_version").category, "model");
relay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: "devin-abc" } }) + "\n");
assert.equal((await next()).params.update.sessionUpdate, "session_info_update"); // the relay's own request never reaches bb
assert.equal((await next()).params.update.content.text, "late"); // the announced reply lands inside the turn
assert.equal((await next()).result.stopReason, "end_turn");
relay.kill();
console.log("ok");
