// Stdio relay between bb's ACP bridge and `devin acp --cloud`. It patches the
// two things the cloud agent's ACP doesn't give bb on its own:
// - `devin_version` (Devin Cloud's model option) has no `category`, so bb
//   wouldn't offer it in the model picker; tag it `model`.
// - A new cloud session has no repo. Pick the one matching the workspace's
//   git origin, so Devin clones the repo the bb thread is in.
// - On follow-up turns the cloud agent answers session/prompt before the
//   reply it announced (is_typing) arrives; bb would drop the late reply.
//   Hold the prompt result until announced replies are delivered.
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const RELAY_FLAG = "--devin-cloud-relay";
// ponytail: cap on waiting for an announced reply; a reply later than this is dropped by bb.
const REPLY_WAIT_MS = 10_000;

type Json = Record<string, any>;

/** Tags Devin Cloud's model option in any configOptions a message carries. */
export function tagModelOption(msg: Json): void {
  const options = msg.result?.configOptions ?? msg.params?.update?.configOptions;
  if (!Array.isArray(options)) return;
  for (const option of options) {
    if (option?.id === "devin_version" && option.category === undefined) option.category = "model";
  }
}

/** The `repos` value matching a git remote URL (ssh or https), if Devin offers it. */
export function matchRepo(configOptions: unknown, remote: string): string | null {
  if (!Array.isArray(configOptions)) return null;
  const repos = configOptions.find((o) => o?.id === "repos");
  if (!Array.isArray(repos?.options) || repos.currentValue) return null;
  const slug = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim())?.[1]?.toLowerCase();
  const hit = repos.options.find((o: Json) => typeof o?.value === "string" && o.value.toLowerCase() === slug);
  return hit?.value ?? null;
}

function originOf(cwd: string): string {
  try {
    return execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

export function runRelay([command, ...args]: string[]): void {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const toAgent = (msg: Json) => child.stdin.write(JSON.stringify(msg) + "\n");
  const toBridge = (line: string) => process.stdout.write(line + "\n");
  const newSessionCwd = new Map<unknown, string>(); // session/new request id → cwd
  const held = new Map<string, Json>(); // our set_config_option id → held session/new result
  let seq = 0;
  const promptSession = new Map<unknown, string>(); // session/prompt request id → sessionId
  const typing = new Map<string, number>(); // sessionId → announced replies not yet delivered
  const heldPrompt = new Map<string, { line: string; timer: NodeJS.Timeout }>();
  const releasePrompt = (sessionId: string) => {
    const hold = heldPrompt.get(sessionId);
    if (!hold) return;
    heldPrompt.delete(sessionId);
    clearTimeout(hold.timer);
    toBridge(hold.line);
  };

  createInterface({ input: process.stdin }).on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.method === "session/new") newSessionCwd.set(msg.id, msg.params?.cwd);
      if (msg.method === "session/prompt") {
        promptSession.set(msg.id, msg.params?.sessionId);
        typing.set(msg.params?.sessionId, 0);
      }
    } catch {}
    child.stdin.write(line + "\n");
  });
  process.stdin.on("end", () => child.stdin.end());

  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      return toBridge(line);
    }
    const pending = held.get(msg.id);
    if (pending) {
      // Our repo selection answered: release the session/new result with its options.
      held.delete(msg.id);
      if (Array.isArray(msg.result?.configOptions)) pending.result.configOptions = msg.result.configOptions;
      tagModelOption(pending);
      return toBridge(JSON.stringify(pending));
    }
    tagModelOption(msg);
    const update = msg.method === "session/update" ? msg.params?.update : undefined;
    if (update) {
      const sessionId = msg.params.sessionId;
      const count = typing.get(sessionId) ?? 0;
      if (update._meta?.["cognition.ai/isTyping"] === true) typing.set(sessionId, count + 1);
      if (update.sessionUpdate === "agent_message_chunk" && count > 0) {
        typing.set(sessionId, count - 1);
        toBridge(JSON.stringify(msg));
        if (count === 1) releasePrompt(sessionId);
        return;
      }
    }
    const promptOf = promptSession.get(msg.id);
    if (promptOf !== undefined) {
      promptSession.delete(msg.id);
      if ((typing.get(promptOf) ?? 0) > 0) {
        const line = JSON.stringify(msg);
        heldPrompt.set(promptOf, { line, timer: setTimeout(() => releasePrompt(promptOf), REPLY_WAIT_MS) });
        return;
      }
    }
    const cwd = newSessionCwd.get(msg.id);
    if (cwd !== undefined && msg.result?.sessionId) {
      newSessionCwd.delete(msg.id);
      const repo = matchRepo(msg.result.configOptions, originOf(cwd));
      if (repo) {
        // Hold the result until the repo is set, so it lands before the first prompt.
        const id = `devin-relay-${++seq}`;
        held.set(id, msg);
        toAgent({ jsonrpc: "2.0", id, method: "session/set_config_option", params: { sessionId: msg.result.sessionId, configId: "repos", value: repo } });
        return;
      }
    }
    toBridge(JSON.stringify(msg));
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
