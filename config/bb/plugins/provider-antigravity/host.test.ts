// Run: node --experimental-strip-types host.test.ts
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  experimental_captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport,
  experimental_runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

// Put the fake `agy` first on PATH before the bridge looks for it.
const bin = mkdtempSync(join(tmpdir(), "fake-agy-"));
writeFileSync(join(bin, "agy"), `#!/bin/sh\nexec node ${fileURLToPath(new URL("./fake-agy.mjs", import.meta.url))} "$@"\n`);
chmodSync(join(bin, "agy"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const { experimental_providerBridge: bridge, modelArgs, parseModels, promptText } = await import("./host.ts");

// Real `agy models` rows: effort families collapse; others take no --effort.
const models = parseModels(
  "Fetching available models...\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n",
);
assert.deepEqual(models.map((m) => [m.id, m.displayName, m.defaultReasoningEffort, m.supportedReasoningEfforts.map((e) => e.reasoningEffort)]), [
  ["gemini-3.1-pro", "Gemini 3.1 Pro", "high", ["low", "high"]],
  ["claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", "none", []],
  ["gpt-oss-120b", "GPT-OSS 120B", "medium", ["medium"]],
]);
assert.deepEqual(modelArgs(models, "gemini-3.1-pro", "low"), ["--model", "gemini-3.1-pro", "--effort", "low"]);
assert.deepEqual(modelArgs(models, "gemini-3.1-pro", "medium"), ["--model", "gemini-3.1-pro", "--effort", "high"]);
assert.deepEqual(modelArgs(models, "claude-opus-4-6-thinking", "high"), ["--model", "claude-opus-4-6-thinking"]);
assert.deepEqual(modelArgs(models, "gemini-3.1-pro-low", "high"), ["--model", "gemini-3.1-pro-low"]);
assert.deepEqual(modelArgs(models, undefined, "high"), []);
assert.equal(promptText([{ type: "text", text: "hi", mentions: [] }, { type: "localFile", path: "/x.png" }]), "hi\n\n[Attached file: /x.png]");

const output = experimental_captureBridgeJsonRpcOutput();
const text = (t: string) => [{ type: "text" as const, text: t, mentions: [] }];
const report = await experimental_runBridgeConformance({
  providerId: "antigravity",
  timeoutMs: 15_000,
  transport: { send: (line) => bridge.handleLine(line), takeMessages: output.takeMessages },
  session: {
    cwd: tmpdir(),
    promptInput: text("ping"),
    zeroWorkPromptInput: text("ZERO"),
    interruptiblePromptInput: text("HOLD"),
    options: { permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null },
  },
});
output.restore();
console.log(experimental_formatConformanceReport(report));
assert.ok(report.passed, "conformance failed");
// A command agy auto-denied closes as denied, and the turn warns about it.
const denyOutput = experimental_captureBridgeJsonRpcOutput();
const send = (id: number, method: string, params: object) => bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
const options = { permissionMode: "accept-edits", permissionScope: "workspace", approvalReviewer: "user", permissionEscalation: "ask" };
const deltas: any[] = [];
const until = async (done: () => boolean) => {
  for (let i = 0; i < 100 && !done(); i++) {
    await new Promise((r) => setTimeout(r, 50));
    for (const m of denyOutput.takeMessages() as any[]) m.method === "thread/delta" ? deltas.push(...m.params.deltas) : deltas.push({ response: m.id });
  }
};
send(1, "thread/start", { threadId: "thr_deny", cwd: tmpdir(), options, instructionMode: "append" });
await until(() => deltas.some((d) => d.response === 1));
send(2, "turn/start", { threadId: "thr_deny", providerThreadId: "pending-thr_deny", clientRequestId: "creq_denydenyd2", input: text("DENY"), options });
await until(() => deltas.some((d) => d.kind === "turn.boundary"));
denyOutput.restore();
assert.ok(deltas.some((d) => d.kind === "item.close" && d.item.type === "command" && d.approvalStatus === "denied" && d.status === "failed"), "denied command not marked denied");
assert.ok(deltas.some((d) => d.kind === "provider.warning" && /auto-denied: RunCommand/.test(d.summary)), "no auto-denied warning");
// Signed out: health says so with the fix.
const healthOutput = experimental_captureBridgeJsonRpcOutput();
process.env.FAKE_AGY_SIGNED_OUT = "1";
send(3, "provider/health", { providerId: "antigravity" });
let health: any;
for (let i = 0; i < 100 && !health; i++) {
  await new Promise((r) => setTimeout(r, 50));
  health = (healthOutput.takeMessages() as any[]).find((m) => m.id === 3)?.result?.health;
}
healthOutput.restore();
assert.equal(health?.status, "unauthenticated");
assert.match(health?.statusMessage ?? "", /Run `agy` in a terminal/);
console.log("ok");
process.exit(0);
