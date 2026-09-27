// Stdio relay between bb's ACP bridge and `devin acp --cloud`. It patches what
// the cloud agent's ACP doesn't give bb on its own:
// - `devin_version` (Devin Cloud's model option) has no `category` and bakes
//   reasoning levels into ids ("devin-swe-2-high" = "SWE-2 High"). Present it
//   as a `model` option with one entry per level family, a `thought_level`
//   option with that family's levels (empty for models without levels), and a
//   `fast` option (bb's service tier, labelled Priority) for families with a
//   "-priority-" tier; translate bb's picks back to the real devin_version.
// - A new cloud session has no repo. Pick the one matching the workspace's
//   git origin, so Devin clones the repo the bb thread is in.
// - A Devin secret request arrives as a generic tool call; retitle it
//   "Devin needs secret NAME" and put the request in its rawInput (bb's item
//   `arguments.devinSecretRequest`) so the server can prompt for it (server.ts).
// - A Devin question (message with cognition.ai/questions) gets a tool-call row
//   "Devin asks: …" carrying the questions (`arguments.devinQuestion`), so the
//   server can offer them as a form.
// - On follow-up turns the cloud agent answers session/prompt before the
//   reply it announced (is_typing) arrives; bb would drop the late reply.
//   Hold the prompt result until announced replies are delivered.
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const RELAY_FLAG = "--devin-cloud-relay";
// ponytail: cap on waiting for an announced reply; a reply later than this is dropped by bb.
const REPLY_WAIT_MS = 10_000;
const VERSION = "devin_version";
const THOUGHT = "thought_level";
const FAST = "fast"; // the option id the bridge sets for bb's service tier

type Json = Record<string, any>;
type Choice = { value: string; name?: string };
type Level = { family: string; familyName: string; effort: string; label: string; priority: boolean };

const EFFORTS: Record<string, string> = { low: "low", medium: "medium", high: "high", "extra high": "xhigh", xhigh: "xhigh", max: "max" };
const NAME_LEVEL = /\s+(low|medium|high|extra high|xhigh|max)(?=(\s*\([^)]*\))?\s*$)/i;
const NAME_PRIORITY = /\s*\(priority\)\s*$/i;
const ID_LEVEL = /^(.+)-(low|medium|high|xhigh|max)$/;

/**
 * Options that belong to a level family: 2+ ids sharing a stem before a -low/-high/-max
 * suffix. A "<stem>-priority-<level>" sibling of a family joins it as its priority tier.
 */
function families(options: Choice[]): Map<string, Level> {
  const parsed = options.map(({ value, name }) => {
    const id = ID_LEVEL.exec(value);
    if (!id) return null;
    // Devin's label wins over the id suffix: "devin-swe-2-low" is "SWE-2 Medium".
    const word = name === undefined ? undefined : NAME_LEVEL.exec(name)?.[1];
    const label = word ?? id[2][0].toUpperCase() + id[2].slice(1);
    const baseName = word ? name!.replace(NAME_LEVEL, "").replace(NAME_PRIORITY, "").trim() : undefined;
    return { stem: id[1], effort: EFFORTS[label.toLowerCase()], label, baseName };
  });
  const stems = new Set(parsed.map((p) => p?.stem));
  const levels = parsed.map((p): Level | null => {
    if (!p) return null;
    const base = /^(.+)-priority$/.exec(p.stem)?.[1];
    const priority = base !== undefined && stems.has(base);
    const family = priority ? base! : p.stem;
    return { family, familyName: p.baseName ?? family, effort: p.effort, label: p.label, priority };
  });
  const size = new Map<string, number>();
  for (const level of levels) if (level) size.set(level.family, (size.get(level.family) ?? 0) + 1);
  const members = new Map<string, Level>();
  options.forEach((option, i) => {
    const level = levels[i];
    if (level && size.get(level.family)! > 1) members.set(option.value, level);
  });
  return members;
}

const find = (members: Map<string, Level>, match: (l: Level) => boolean) =>
  [...members].find(([, l]) => match(l))?.[0] ?? null;

/**
 * Devin's devin_version option as bb sees it: a collapsed model option, a thought_level
 * option with the current family's levels (empty without levels), and a `fast` option
 * (bb's service tier) when the family has a priority tier.
 */
export function collapseVersion(raw: Json): Json[] {
  const choices: Choice[] = raw.options ?? [];
  const members = families(choices);
  const options: Choice[] = [];
  const seen = new Set<string>();
  for (const choice of choices) {
    const level = members.get(choice.value);
    if (!level) options.push(choice);
    else if (!seen.has(level.family)) {
      seen.add(level.family);
      const base = [...members.values()].find((l) => l.family === level.family && !l.priority) ?? level;
      options.push({ value: level.family, name: base.familyName });
    }
  }
  const current = members.get(raw.currentValue);
  const family = current ? [...members.values()].filter((l) => l.family === current.family) : [];
  const levels = new Map<string, string>();
  for (const l of family) if (!levels.has(l.effort) || !l.priority) levels.set(l.effort, l.label);
  const shown: Json[] = [
    { ...raw, category: "model", currentValue: current?.family ?? raw.currentValue, options },
    {
      id: THOUGHT,
      name: "Reasoning",
      category: "thought_level",
      type: "select",
      currentValue: current?.effort ?? "",
      options: [...levels].map(([value, name]) => ({ value, name })),
    },
  ];
  if (family.some((l) => l.priority) && family.some((l) => !l.priority)) {
    shown.push({
      id: FAST,
      name: "Priority",
      type: "select",
      currentValue: String(current!.priority),
      options: [{ value: "false", name: "Off" }, { value: "true", name: "On" }],
    });
  }
  return shown;
}

/** Names of the collapsed models with a priority tier ("SWE-2"), as bb's picker shows them. */
export function priorityModels(raw: Json): string[] {
  const levels = [...families(raw.options ?? []).values()];
  const names = new Set<string>();
  for (const l of levels) {
    if (!l.priority && levels.some((p) => p.priority && p.family === l.family)) names.add(l.familyName);
  }
  return [...names];
}

/** The real devin_version for a picked model: a family keeps the session's level and tier, else Medium, priority off. */
export function expandModel(raw: Json, value: string): string {
  const members = families(raw.options ?? []);
  if (members.get(raw.currentValue)?.family === value) return raw.currentValue;
  return (
    find(members, (l) => l.family === value && l.effort === "medium" && !l.priority) ??
    find(members, (l) => l.family === value && !l.priority) ??
    find(members, (l) => l.family === value) ??
    value // a real id: a model without levels, or a legacy thread's id
  );
}

/** The real devin_version for a picked level of the session's current family, keeping its tier. */
export function expandLevel(raw: Json, effort: string): string | null {
  const members = families(raw.options ?? []);
  const current = members.get(raw.currentValue);
  if (!current) return null;
  return (
    find(members, (l) => l.family === current.family && l.effort === effort && l.priority === current.priority) ??
    find(members, (l) => l.family === current.family && l.effort === effort)
  );
}

/** The real devin_version for bb's service tier ("true" = priority) at the session's level. */
export function expandTier(raw: Json, fast: string): string | null {
  const members = families(raw.options ?? []);
  const current = members.get(raw.currentValue);
  if (!current) return null;
  return find(members, (l) => l.family === current.family && l.effort === current.effort && l.priority === (fast === "true"));
}

/** Whether a picked model is a real family member id (stored by threads from before the collapse). */
export function isLegacyId(raw: Json, value: string): boolean {
  return families(raw.options ?? []).has(value);
}

export type SecretRequest = { name: string; note: string; requestId: string; save: boolean };

/** A Devin Cloud secret request (`request_secret` tool call): name, note, request id, and whether Devin suggests saving it. */
export function secretRequest(update: Json): SecretRequest | null {
  const meta = update?._meta;
  if (update?.sessionUpdate !== "tool_call" || meta?.["cognition.ai/eventType"] !== "request_secret") return null;
  const name = meta["cognition.ai/secretName"];
  const requestId = meta["cognition.ai/requestId"] ?? update.toolCallId;
  if (typeof name !== "string" || !name || typeof requestId !== "string" || !requestId) return null;
  return { name, note: String(meta["cognition.ai/note"] ?? ""), requestId, save: meta["cognition.ai/shouldSave"] === true };
}

export type DevinQuestion = { id: string; questions: { question: string; options: string[]; multiple: boolean }[] };

/** A Devin question: a message whose meta carries `cognition.ai/questions` (options per question). */
export function devinQuestion(update: Json): DevinQuestion | null {
  const meta = update?._meta;
  if (update?.sessionUpdate !== "agent_message_chunk" || meta?.["cognition.ai/userQuestion"] !== true) return null;
  const raw = meta["cognition.ai/questions"];
  const id = meta["cognition.ai/eventId"];
  if (!Array.isArray(raw) || typeof id !== "string") return null;
  const questions = raw
    .filter((q) => typeof q?.question === "string" && Array.isArray(q.options))
    .map((q) => ({ question: q.question, options: q.options.filter((o: unknown) => typeof o === "string"), multiple: q.allow_multiple === true }));
  return questions.length > 0 ? { id, questions } : null;
}

/** The thread message that answers a question: each question's picks, one line per question. */
export function questionAnswer(question: DevinQuestion, picks: string[][]): string {
  const lines = question.questions.map((q, i) => (picks[i] ?? []).join(", "));
  return question.questions.length === 1 ? lines[0] : question.questions.map((q, i) => `${q.question}: ${lines[i]}`).join("\n");
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
  const requestSession = new Map<unknown, string>(); // request id → sessionId
  const newSessionCwd = new Map<unknown, string>(); // session/new request id → cwd
  const held = new Map<string, Json>(); // our set_config_option id → held session/new result
  let seq = 0;
  const promptSession = new Map<unknown, string>(); // session/prompt request id → sessionId
  const typing = new Map<string, number>(); // sessionId → announced replies not yet delivered
  const heldPrompt = new Map<string, { line: string; timer: NodeJS.Timeout }>();
  const agentOptions = new Map<string, Json[]>(); // sessionId → Devin's own latest configOptions
  const legacyPick = new Set<string>(); // sessions whose model pick was a legacy id (its level is baked in)

  const version = (sessionId: string) => agentOptions.get(sessionId)?.find((o) => o?.id === VERSION);
  /** Remembers Devin's options and rewrites them for bb, in place. */
  const present = (msg: Json, sessionId: string | undefined) => {
    const options = (msg.result ?? msg.params?.update)?.configOptions;
    if (!Array.isArray(options)) return;
    if (sessionId) agentOptions.set(sessionId, structuredClone(options));
    const at = options.findIndex((o) => o?.id === VERSION);
    if (at >= 0) options.splice(at, 1, ...collapseVersion(options[at]));
  };
  const emit = (msg: Json, sessionId?: string) => {
    present(msg, sessionId);
    toBridge(JSON.stringify(msg));
  };
  const releasePrompt = (sessionId: string) => {
    const hold = heldPrompt.get(sessionId);
    if (!hold) return;
    heldPrompt.delete(sessionId);
    clearTimeout(hold.timer);
    toBridge(hold.line);
  };

  /** Rewrites bb's pick of a collapsed model, level, or tier; returns false when it's answered here instead. */
  const translatePick = (msg: Json): boolean => {
    const { sessionId, configId, value } = msg.params ?? {};
    const raw = version(sessionId);
    const picksAfterModel = msg.method === "session/set_config_option" && (configId === THOUGHT || configId === FAST);
    // The bridge sets level and tier right after the model; a legacy id already carries both.
    const legacy = legacyPick.has(sessionId);
    if (!picksAfterModel) legacyPick.delete(sessionId);
    if (msg.method !== "session/set_config_option" || !raw || !(configId === VERSION || picksAfterModel)) return true;
    let real: string | null;
    if (configId === VERSION) {
      real = expandModel(raw, value);
      if (isLegacyId(raw, value)) legacyPick.add(sessionId);
    } else if (legacy) real = null;
    else real = configId === THOUGHT ? expandLevel(raw, value) : expandTier(raw, value);
    if (real === null || real === raw.currentValue) {
      emit({ jsonrpc: "2.0", id: msg.id, result: { configOptions: structuredClone(agentOptions.get(sessionId)) } });
      return false;
    }
    msg.params = { ...msg.params, configId: VERSION, value: real };
    return true;
  };

  createInterface({ input: process.stdin }).on("line", (line) => {
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      return child.stdin.write(line + "\n");
    }
    if (msg.id !== undefined && msg.params?.sessionId) requestSession.set(msg.id, msg.params.sessionId);
    if (msg.method === "session/new") newSessionCwd.set(msg.id, msg.params?.cwd);
    if (msg.method === "session/prompt") {
      promptSession.set(msg.id, msg.params?.sessionId);
      typing.set(msg.params?.sessionId, 0);
    }
    if (translatePick(msg)) toAgent(msg);
  });
  process.stdin.on("end", () => child.stdin.end());

  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      return toBridge(line);
    }
    const sessionId = msg.result?.sessionId ?? msg.params?.sessionId ?? requestSession.get(msg.id);
    if (msg.id !== undefined && msg.method === undefined) requestSession.delete(msg.id);
    const pending = held.get(msg.id);
    if (pending) {
      // Our repo selection answered: release the session/new result with its options.
      held.delete(msg.id);
      if (Array.isArray(msg.result?.configOptions)) pending.result.configOptions = msg.result.configOptions;
      return emit(pending, pending.result.sessionId);
    }
    const update = msg.method === "session/update" ? msg.params?.update : undefined;
    const secret = update ? secretRequest(update) : null;
    const question = update ? devinQuestion(update) : null;
    if (question) {
      // Before the message itself, so the row lands inside the turn even when its end is held.
      const title = `Devin asks: ${question.questions[0].question}`;
      toBridge(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId: `devin-question-${question.id}`, kind: "other", status: "completed", title, rawInput: { devinQuestion: question } } },
      }));
    }
    if (secret) {
      update.title = `Devin needs secret ${secret.name}${secret.note ? ` — ${secret.note}` : ""}`;
      update.rawInput = { devinSecretRequest: secret };
    }
    if (update) {
      const count = typing.get(sessionId) ?? 0;
      if (update._meta?.["cognition.ai/isTyping"] === true) typing.set(sessionId, count + 1);
      if (update.sessionUpdate === "agent_message_chunk" && count > 0) {
        typing.set(sessionId, count - 1);
        emit(msg, sessionId);
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
    emit(msg, sessionId);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
