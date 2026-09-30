#!/usr/bin/env node
// Test double for `agy`, replaying the stream-json shapes real agy 1.2.14 prints.
// Prompts containing HOLD run until killed; ZERO completes with no steps; DENY has its command auto-denied.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("1.2.14");
  process.exit(0);
}
if (args[0] === "models" && process.env.FAKE_AGY_SIGNED_OUT) {
  // Real agy output when not signed in.
  console.log("Fetching available models...");
  console.error("Error: Please sign in to view available models. Launch the CLI without arguments to sign in.");
  process.exit(1);
}
if (args[0] === "models") {
  console.log("Fetching available models...");
  console.log("gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)");
  process.exit(0);
}

const at = args.indexOf("--conversation");
const conversation_id = at >= 0 ? args[at + 1] : randomUUID();
const out = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const step = (step_index, fields) => out({ event: "step_update", step_update: { conversation_id, step_index, ...fields } });
const usage = { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 0, total_tokens: 110 };

const [line] = await createInterface({ input: process.stdin })[Symbol.asyncIterator]().next().then((r) => [r.value]);
const content = JSON.parse(line).message.content;
out({ event: "init", conversation_id, init: { cwd: process.cwd(), tools: [], permission_mode: "request-review" } });
step(0, { state: "DONE", step_type: "user_input" });
if (content.includes("HOLD")) {
  setInterval(() => {}, 1000);
} else if (content.includes("DENY")) {
  const tool_info = { name: "run_command", parameters: { CommandLine: "echo hi" } };
  step(1, { state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info });
  step(1, { state: "DONE", step_type: "tool", tool_name: "run_command", tool_info });
  out({ event: "result", result: { conversation_id, status: "SUCCESS", response: "", num_turns: 1, usage, denied_actions: [{ action: "command", display_name: "RunCommand" }] } });
} else {
  if (!content.includes("ZERO")) {
    const tool_info = { name: "run_command", parameters: { CommandLine: "ls" } };
    step(1, { state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info });
    step(1, { state: "DONE", step_type: "tool", tool_name: "run_command", tool_info: { ...tool_info, output: "a.txt\r\n" } });
    step(2, { state: "ACTIVE", step_type: "agent_response", text_delta: "pong" });
    step(2, { state: "DONE", step_type: "agent_response", text_delta: "\n", usage });
  }
  out({ event: "result", result: { conversation_id, status: "SUCCESS", response: "pong\n", num_turns: 1, usage } });
}
