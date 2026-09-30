import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  BRIDGE_JSON_RPC_ERRORS as E,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  buildShellEnvOverrides,
  createBridgeIo,
  createBridgeLineHandler,
  experimental_BridgeRecoveryError as RecoveryError,
  experimental_defineProviderBridge,
  experimental_readCliVersion,
  experimental_recordProviderChildIo,
  experimental_resolveExecutablePath,
  experimental_toolPresentation,
  modelListParamsSchema,
  providerMaintenanceParamsSchema,
  sanitizeInheritedChildProcessEnv,
  threadDiscardParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  withoutBridgeRuntimeEnv,
  type AvailableModel,
  type DeltaItemShape,
  type PromptInput,
  type ProviderHealth,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";

// ---- agy facts (from real `agy` 1.2.14 output) ----

const INSTALL_HINT = "Install the Antigravity CLI with `brew install --cask antigravity-cli`.";
const SIGN_IN_HINT = "Antigravity isn't signed in. Run `agy` in a terminal and complete the Google sign-in, then retry.";
const isSignInError = (text: string) => /sign in|not authenticated|unauthenticated|login required/i.test(text);
const EFFORTS = ["low", "medium", "high", "max"] as const;
type Effort = (typeof EFFORTS)[number];
// Thread ids before agy has created the conversation (agy mints the id on the first turn).
const PENDING = "pending-";

/**
 * `agy models` prints `id\tName` rows. agy groups `<family>-<effort>` ids itself
 * (`--model gemini-3.8-flash --effort low` is valid; `--model gemini-3.8-flash-low --effort x`
 * is not), so a family becomes one model with reasoning levels. Other ids take no --effort.
 */
export function parseModels(stdout: string): AvailableModel[] {
  const families = new Map<string, { name: string; efforts: Effort[] }>();
  for (const line of stdout.split("\n")) {
    const [id, name] = line.split("\t").map((s) => s?.trim());
    if (!id || !name) continue;
    const idMatch = /^(.+)-(low|medium|high|max)$/.exec(id);
    const nameMatch = /^(.+) \((low|medium|high|max)\)$/i.exec(name);
    const key = idMatch && nameMatch ? idMatch[1] : id;
    const family = families.get(key) ?? { name: idMatch && nameMatch ? nameMatch[1] : name, efforts: [] };
    if (idMatch && nameMatch) family.efforts.push(idMatch[2] as Effort);
    families.set(key, family);
  }
  return [...families].map(([id, { name, efforts }], index) => {
    const sorted = EFFORTS.filter((e) => efforts.includes(e));
    return {
      id,
      model: id,
      displayName: name,
      description: name,
      isDefault: index === 0,
      defaultReasoningEffort: sorted.length === 0 ? "none" : sorted.includes("medium") ? "medium" : sorted[sorted.length - 1],
      supportedReasoningEfforts: sorted.map((e) => ({ reasoningEffort: e, description: e })),
    };
  });
}

/** `--model/--effort` for a picked model. Unknown ids (e.g. `gemini-3.8-flash-low`) pass through as-is. */
export function modelArgs(models: AvailableModel[], model: string | undefined, level: string | undefined): string[] {
  if (!model) return [];
  const efforts = models.find((m) => m.id === model)?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ?? [];
  if (efforts.length === 0) return ["--model", model];
  const effort = efforts.includes(level as Effort) ? level! : models.find((m) => m.id === model)!.defaultReasoningEffort;
  return ["--model", model, "--effort", effort];
}

type AgyTool = { name?: string; parameters?: Record<string, unknown>; output?: string; error?: { message?: string } };

/** bb's item shape for an agy tool step. Tools without a better shape render as generic tools. */
export function toolShape(tool: AgyTool, cwd: string): DeltaItemShape {
  const p = tool.parameters ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (tool.name) {
    case "run_command":
      return { type: "command", command: str(p.CommandLine) ?? "", cwd: str(p.Cwd) ?? cwd };
    case "view_file":
      if (str(p.AbsolutePath)) return { type: "fileRead", path: str(p.AbsolutePath)! };
      break;
    case "write_to_file":
    case "replace_file_content":
    case "multi_replace_file_content":
    case "sed_file":
      if (str(p.TargetFile)) {
        return { type: "fileChange", changes: [{ path: str(p.TargetFile)!, kind: tool.name === "write_to_file" ? "add" : "update" }] };
      }
      break;
    case "search_web":
      return { type: "webSearch", queries: str(p.query) ? [str(p.query)!] : [] };
    case "read_url_content":
      if (str(p.Url)) return { type: "webFetch", url: str(p.Url)!, pattern: null };
      break;
  }
  return {
    type: "tool",
    tool: tool.name ?? "tool",
    args: p,
    ...(tool.output === undefined ? {} : { result: tool.output }),
    ...(tool.error?.message === undefined ? {} : { error: tool.error.message }),
  };
}

// ponytail: images and files go in as paths for agy's own view_file; agy's stream-json image blocks are undocumented.
export function promptText(input: PromptInput[]): string {
  return input
    .map((part) =>
      part.type === "text" ? part.text : part.type === "image" ? "[Image attachment omitted]" : `[Attached file: ${part.path}]`,
    )
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function errorCategory(message: string) {
  if (isSignInError(message)) return "unauthorized" as const;
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) return "rate-limit" as const;
  if (/\b503\b|UNAVAILABLE|overloaded/i.test(message)) return "overloaded" as const;
  return "unknown" as const;
}

// ---- process helpers ----

function childEnv(envVars?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...sanitizeInheritedChildProcessEnv({ env: withoutBridgeRuntimeEnv(process.env) }), ...buildShellEnvOverrides(envVars) };
}

async function findAgy(): Promise<string | null> {
  const found = await experimental_resolveExecutablePath("agy");
  if (found) return found;
  // The daemon's PATH may not include Homebrew.
  return ["/opt/homebrew/bin/agy", "/usr/local/bin/agy"].find((p) => existsSync(p)) ?? null;
}

async function requireAgy(): Promise<string> {
  const agy = await findAgy();
  if (!agy) throw Object.assign(new Error(`Antigravity CLI (agy) not found. ${INSTALL_HINT}`), { code: E.MISSING_EXECUTABLE });
  return agy;
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout: 30_000, env: childEnv() }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: `${stdout}${stderr}` }),
    ),
  );
}

let modelCache: Promise<AvailableModel[]> | null = null;
function listModels(refresh = false): Promise<AvailableModel[]> {
  if (!modelCache || refresh) {
    modelCache = (async () => {
      const { ok, out } = await run(await requireAgy(), ["models"]);
      if (isSignInError(out)) {
        throw new RecoveryError({ code: E.BRIDGE_ERROR, message: SIGN_IN_HINT, recovery: { kind: "authRequired", message: SIGN_IN_HINT, retryable: true } });
      }
      const models = parseModels(out);
      if (!ok || models.length === 0) throw new Error(`\`agy models\` failed: ${out.trim().slice(-400)}`);
      return models;
    })();
    modelCache.catch(() => (modelCache = null));
  }
  return modelCache;
}

function accountEmail(): string | null {
  try {
    const active = JSON.parse(readFileSync(join(homedir(), ".gemini", "google_accounts.json"), "utf8")).active;
    return typeof active === "string" && active ? active : null;
  } catch {
    return null;
  }
}

async function health(): Promise<ProviderHealth> {
  const base = {
    accountEmail: null,
    canInstall: false,
    canUpdate: false,
    installedVersion: null,
    loginCommand: "agy",
    minimumSupportedVersion: null,
    planLabel: null,
    statusMessage: null,
  };
  const agy = await findAgy();
  if (!agy) return { ...base, status: "not_installed", statusMessage: INSTALL_HINT };
  const installedVersion = await experimental_readCliVersion(agy);
  const { ok, out } = await run(agy, ["models"]);
  if (isSignInError(out)) return { ...base, installedVersion, status: "unauthenticated", statusMessage: SIGN_IN_HINT };
  if (!ok) return { ...base, installedVersion, status: "unknown", statusMessage: out.trim().slice(-400) || null };
  return { ...base, installedVersion, accountEmail: accountEmail(), status: "ready" };
}

// ---- bridge ----

const io = createBridgeIo<unknown>();
const notify = (method: string, params: unknown) => io.send({ jsonrpc: "2.0", method, params });
const emit = (threadId: string, deltas: ThreadDelta[]) => notify("thread/delta", { threadId, deltas });

type TurnInput = { input: PromptInput[]; clientRequestIds: string[]; options: Record<string, any> };
type Turn = { child?: ChildProcess; interrupted: boolean; released: boolean; settled: Promise<void> };
type Thread = { cwd: string; conversationId: string | null; turn: Turn | null; queue: TurnInput[] };
const threads = new Map<string, Thread>();

function openThread(threadId: string, cwd: string, conversationId: string | null) {
  const existing = threads.get(threadId);
  threads.set(threadId, { cwd, conversationId, turn: existing?.turn ?? null, queue: existing?.queue ?? [] });
  const providerThreadId = conversationId ?? `${PENDING}${threadId}`;
  notify("thread/identity", { threadId, providerThreadId });
  emit(threadId, [{ kind: "session.reset" }]);
  return { providerThreadId };
}

function startTurn(threadId: string, thread: Thread, next: TurnInput): void {
  let settle!: () => void;
  const turn: Turn = { interrupted: false, released: false, settled: new Promise((r) => (settle = r)) };
  thread.turn = turn;
  emit(threadId, [...next.clientRequestIds.map((id) => ({ kind: "input.accepted" as const, clientRequestId: id })), { kind: "turn.open" }]);

  const nonce = randomUUID().slice(0, 8); // provider item ids must never repeat across turns
  const openText = new Set<string>();
  const openTools = new Map<string, DeltaItemShape>();
  const last = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
  let result: any = null;
  let stderr = "";
  let finished = false;

  const finish = (status: "completed" | "failed" | "interrupted", error?: string) => {
    if (finished) return; // a spawn failure fires both "error" and "close"
    finished = true;
    if (turn.released) return settle();
    const deltas: ThreadDelta[] = [];
    for (const key of openText) deltas.push({ kind: "item.textClose", channel: "agentMessage", key: { providerItemId: key } });
    for (const [key, item] of openTools) deltas.push({ kind: "item.close", key: { providerItemId: key }, item, status: status === "completed" ? "completed" : status });
    if (result?.usage) {
      const u = result.usage;
      deltas.push({
        kind: "usage",
        last,
        total: { inputTokens: u.input_tokens ?? 0, cachedInputTokens: u.cache_read_tokens ?? 0, outputTokens: u.output_tokens ?? 0, reasoningOutputTokens: u.thinking_tokens ?? 0, totalTokens: u.total_tokens ?? 0 },
        modelContextWindow: null,
      });
    }
    const denied: string[] = (result?.denied_actions ?? []).map((a: any) => a?.display_name ?? a?.action).filter(Boolean);
    if (denied.length > 0) {
      deltas.push({
        kind: "provider.warning",
        vouchedTurn: true,
        summary: `Antigravity auto-denied: ${[...new Set(denied)].join(", ")}`,
        details: "Headless agy can't ask for approval. Switch this thread to Full access, or add permissions.allow rules to ~/.gemini/antigravity-cli/settings.json.",
      });
    }
    if (error) {
      const category = errorCategory(error);
      const message = category === "unauthorized" ? SIGN_IN_HINT : error;
      deltas.push({ kind: "provider.error", message, ...(message === error ? {} : { detail: error }), category });
      if (category === "unauthorized") notify("provider/recovery", { threadId, kind: "authRequired", message, retryable: true });
    }
    deltas.push({ kind: "turn.boundary", status, ...(error ? { error: { message: error } } : {}) });
    emit(threadId, deltas);
    if (thread.turn === turn) thread.turn = null;
    settle();
    // Steers queue behind the running turn (agy has no mid-turn input); run them as the next turn.
    if (status !== "interrupted" && thread.queue.length > 0 && threads.get(threadId) === thread) {
      const queued = thread.queue.splice(0);
      startTurn(threadId, thread, {
        input: queued.flatMap((q) => q.input),
        clientRequestIds: queued.flatMap((q) => q.clientRequestIds),
        options: queued[queued.length - 1].options,
      });
    }
  };

  // agy reports a denied command as a DONE step without output and names the denial only in
  // `result`, which follows at once. Hold such a step until the next event to tell them apart.
  let held: { key: string; item: DeltaItemShape } | null = null;
  const closeHeld = (denied: boolean) => {
    if (!held) return;
    const { key, item } = held;
    held = null;
    openTools.delete(key);
    emit(threadId, [{ kind: "item.close", key: { providerItemId: key }, item, ...(denied ? { status: "failed", approvalStatus: "denied" } : { status: "completed" }) }]);
  };

  const onEvent = (event: any) => {
    if (event.event !== "result") closeHeld(false);
    if (event.event === "init" && event.conversation_id && event.conversation_id !== thread.conversationId) {
      const deltas: ThreadDelta[] = [{ kind: "thread.identity", providerThreadId: event.conversation_id }];
      if (thread.conversationId) {
        deltas.push({ kind: "provider.warning", vouchedTurn: true, summary: `Antigravity couldn't find conversation ${thread.conversationId}; this turn started a new one.` });
      }
      thread.conversationId = event.conversation_id;
      emit(threadId, deltas);
    } else if (event.event === "step_update") {
      const step = event.step_update ?? {};
      const key = `${nonce}-${step.step_index}`;
      const done = step.state === "DONE" || step.state === "ERROR";
      if (step.step_type === "agent_response") {
        const deltas: ThreadDelta[] = [];
        if (step.text_delta) {
          openText.add(key);
          deltas.push({ kind: "item.textDelta", channel: "agentMessage", key: { providerItemId: key }, text: step.text_delta });
        }
        if (done && openText.delete(key)) deltas.push({ kind: "item.textClose", channel: "agentMessage", key: { providerItemId: key } });
        if (done && step.usage) {
          last.inputTokens += step.usage.input_tokens ?? 0;
          last.cachedInputTokens += step.usage.cache_read_tokens ?? 0;
          last.outputTokens += step.usage.output_tokens ?? 0;
          last.reasoningOutputTokens += step.usage.thinking_tokens ?? 0;
          last.totalTokens += step.usage.total_tokens ?? 0;
        }
        if (deltas.length > 0) emit(threadId, deltas);
      } else if (step.step_type === "tool") {
        const tool: AgyTool = step.tool_info ?? { name: step.tool_name };
        const item = toolShape(tool, thread.cwd);
        const deltas: ThreadDelta[] = [];
        if (!openTools.has(key)) {
          deltas.push({ kind: "item.open", key: { providerItemId: key }, item, ...(item.type === "tool" ? { presentation: experimental_toolPresentation(item.tool) } : {}) });
        }
        openTools.set(key, item);
        if (done && item.type === "command" && step.state === "DONE" && tool.output === undefined) {
          held = { key, item };
        } else if (done) {
          openTools.delete(key);
          const denied = /denied permission/i.test(tool.error?.message ?? "");
          deltas.push({
            kind: "item.close",
            key: { providerItemId: key },
            item,
            status: step.state === "ERROR" ? "failed" : "completed",
            ...(denied ? { approvalStatus: "denied" as const } : {}),
            ...(tool.output === undefined ? {} : { aggregatedOutput: tool.output }),
            ...(tool.error?.message === undefined ? {} : { resultText: tool.error.message }),
          });
        }
        if (deltas.length > 0) emit(threadId, deltas);
      }
    } else if (event.event === "result") {
      result = event.result ?? {};
      closeHeld((result.denied_actions ?? []).some((a: any) => a?.action === "command"));
    }
  };

  (async () => {
    const agy = await requireAgy();
    const models = next.options.model ? await listModels().catch(() => []) : [];
    const o = next.options;
    const args = [
      "--print=",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      ...(thread.conversationId ? ["--conversation", thread.conversationId] : []),
      ...modelArgs(models, o.model, o.reasoningLevel),
      ...(o.permissionMode === "full" ? ["--dangerously-skip-permissions"] : ["--mode", "accept-edits"]),
    ];
    // agy has no system-prompt flag: bb's instructions ride along with the conversation's first message.
    const text = promptText(next.input);
    const content = !thread.conversationId && o.instructions ? `<instructions>\n${o.instructions}\n</instructions>\n\n${text}` : text;
    if (turn.interrupted || turn.released) return finish("interrupted");
    const child = spawn(agy, args, { cwd: thread.cwd, env: childEnv(o.envVars), stdio: ["pipe", "pipe", "pipe"] });
    turn.child = child;
    experimental_recordProviderChildIo(child, { threadId });
    createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        onEvent(JSON.parse(line));
      } catch {
        // agy prints only NDJSON on stdout; ignore anything else
      }
    });
    child.stderr!.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    child.stdin!.on("error", () => {});
    child.stdin!.end(JSON.stringify({ event: "user", message: { role: "user", content } }) + "\n");
    child.on("error", (error) => finish("failed", `Couldn't start agy: ${error.message}`));
    child.on("close", () => {
      if (turn.interrupted) return finish("interrupted");
      if (result?.status === "SUCCESS") return finish("completed");
      finish("failed", result?.error || stderr.trim().slice(-800) || "agy exited without a result");
    });
  })().catch((error) => finish("failed", error instanceof Error ? error.message : String(error)));
}

// agy stops its own command children on SIGTERM but needs a few seconds; SIGKILL earlier orphans them.
function killTurn(turn: Turn) {
  const child = turn.child;
  if (!child) return;
  child.kill("SIGTERM");
  setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL"), 10_000).unref();
}

type Handler = { schema?: { safeParse(v: unknown): { success: boolean; data?: any; error?: any } }; run(params: any): unknown };
const handlers: Record<string, Handler> = {
  initialize: {
    run: () => ({
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        approvalEnforcedBy: "provider",
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        steerMode: "queue",
      },
    }),
  },
  "model/list": {
    schema: modelListParamsSchema,
    run: async () => ({ models: await listModels(true), selectedOnlyModels: [] }),
  },
  "provider/health": {
    schema: providerMaintenanceParamsSchema,
    run: async () => ({ supported: true, health: await health() }),
  },
  "thread/start": {
    schema: threadStartParamsSchema,
    run: async (p) => {
      await requireAgy();
      return openThread(p.threadId, p.cwd, null);
    },
  },
  "thread/resume": {
    schema: threadResumeParamsSchema,
    run: async (p) => {
      await requireAgy();
      return openThread(p.threadId, p.cwd, p.providerThreadId.startsWith(PENDING) ? null : p.providerThreadId);
    },
  },
  "turn/start": {
    schema: turnStartParamsSchema,
    run: (p) => {
      const thread = threads.get(p.threadId);
      if (!thread) throw new Error(`Thread ${p.threadId} has no Antigravity session; start or resume it first.`);
      if (thread.turn) throw new Error("A turn is already running on this thread.");
      startTurn(p.threadId, thread, { input: p.input, clientRequestIds: [p.clientRequestId], options: p.options });
      return {};
    },
  },
  "turn/steer": {
    schema: turnSteerParamsSchema,
    run: (p) => {
      const thread = threads.get(p.threadId);
      if (!thread?.turn) throw Object.assign(new Error("No active turn to steer."), { code: E.NO_ACTIVE_TURN });
      thread.queue.push({ input: p.input, clientRequestIds: [p.clientRequestId], options: p.options });
      return {};
    },
  },
  "thread/stop": {
    schema: threadStopParamsSchema,
    run: async (p) => {
      const thread = threads.get(p.threadId);
      const turn = thread?.turn;
      if (p.intent === "release") {
        if (turn) {
          turn.released = true;
          killTurn(turn);
        }
        threads.delete(p.threadId);
      } else if (thread && turn) {
        thread.queue = [];
        turn.interrupted = true;
        killTurn(turn);
        await turn.settled;
      }
      return {};
    },
  },
  "thread/discard": {
    schema: threadDiscardParamsSchema,
    run: (p) => {
      const turn = threads.get(p.threadId)?.turn;
      if (turn) {
        turn.released = true;
        killTurn(turn);
      }
      threads.delete(p.threadId);
      return {};
    },
  },
};

async function handleRequest(id: string | number, method: string, params: unknown) {
  const handler = handlers[method];
  if (!handler) return io.sendError(id, E.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  const parsed = handler.schema ? handler.schema.safeParse(params ?? {}) : { success: true, data: params };
  if (!parsed.success) return io.sendError(id, E.INVALID_PARAMS, `Invalid params for ${method}: ${parsed.error?.message ?? ""}`);
  try {
    io.sendResult(id, await handler.run(parsed.data));
  } catch (error: any) {
    if (error instanceof RecoveryError) return io.sendError(id, error.code, error.message, { recovery: error.recovery });
    io.sendError(id, typeof error?.code === "number" ? error.code : E.BRIDGE_ERROR, error?.message ?? String(error));
  }
}

const handleLine = createBridgeLineHandler({
  handleParsedMessage(message: any) {
    // Requests only: responses and notifications from the runtime need no answer.
    if (typeof message?.method !== "string" || (typeof message.id !== "string" && typeof message.id !== "number")) return;
    void handleRequest(message.id, message.method, message.params);
  },
});

function shutdown() {
  for (const thread of threads.values()) if (thread.turn) killTurn(thread.turn);
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onClose: shutdown,
  onSigterm: shutdown,
  onSigint: shutdown,
});
