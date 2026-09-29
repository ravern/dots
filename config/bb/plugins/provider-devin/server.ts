import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
  type PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { z } from "zod";
import { priorityModels, questionAnswer, type DevinQuestion, type SecretRequest } from "./relay.ts";

export const CLOUD = "devin-cloud";
export const SESSION_CHANNEL = "session";
const VM_TITLE = "Devin VM";
export const SECRET_FORM = "devin-secret";
export const QUESTION_FORM = "devin-question";
const FORM_TIMEOUT_MS = 60 * 60_000; // also the age past which a secret request or question is stale
// Land in the session's repo: the relay picks at most one, cloned under ~/repos.
const VM_COMMAND = (url: string) => `devin ssh ${url} -t 'cd ~/repos/*/ 2>/dev/null; exec "$SHELL" -l'`;

// Devin works on its own VM and never asks bb for permission, so Full access is the only mode.
// The relay collapses Devin's level families (SWE-2 Medium/High/Max) into one model with
// reasoning levels; models without levels advertise none. A family's "-priority-" tier is bb's
// service tier, labelled Priority. bb declares tiers per provider, not per model: models
// without a priority tier show the switch too, and it does nothing for them.
const cloud: PluginProviderDeclaration = {
  id: CLOUD,
  displayName: "Devin Cloud",
  icon: "./icons/cognition.svg",
  experimental_bridgeOptions: {
    acpLaunchSpec: { displayName: "Devin Cloud", command: "devin", args: ["acp", "--cloud"], env: {} },
    acpDialect: "generic",
    // Makes the bridge pass bb's service tier (Priority) through to the relay's `fast` option.
    parameterizedModelPicker: true,
  },
  capabilities: {
    supportsServiceTier: true,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["full"],
    reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  serviceTiers: [{ id: "fast", label: "Priority", description: "Devin's priority capacity, for models that offer it" }],
  composerActions: [],
  strings: {
    signInHint: "Run `devin auth login` on this machine.",
    expiredHint: "Your Devin login expired. Run `devin auth login`, then reload.",
    installUrl: "https://docs.devin.ai/cli",
  },
  models: { scope: "host" },
};

type Tab = { id: string; kind: string; terminalId?: string; [key: string]: unknown };

/** The panel tab bb uses for a thread terminal (its id scheme is `terminal:<terminalId>:none`). */
export const vmTab = (threadId: string, terminalId: string): Tab => ({
  id: `terminal:${encodeURIComponent(terminalId)}:none`,
  kind: "terminal",
  terminalId,
  target: { kind: "thread", threadId },
});

/** The thread's tabs with the VM terminal's tab added, or null when it's already there. */
export function withVmTab(tabs: readonly Tab[], tab: Tab): Tab[] | null {
  return tabs.some((t) => t.kind === "terminal" && t.terminalId === tab.terminalId) ? null : [...tabs, tab];
}

/** Devin web app URL for a cloud ACP session id (`devin-<hex>`). */
export function sessionUrl(providerThreadId: string | undefined): string | null {
  const hex = /^devin-([0-9a-f]+)$/.exec(providerThreadId ?? "")?.[1];
  return hex ? `https://app.devin.ai/sessions/${hex}` : null;
}

type CloudReply = { result?: any; error?: { code?: number } };

/**
 * One request on a fresh `devin acp --cloud` connection. The reply's error is reduced to its
 * code: Devin's validation messages echo the request, which may hold a secret value.
 */
function cloudRequest(method: string, params: object): Promise<CloudReply | null> {
  return new Promise((resolve) => {
    const child = spawn("devin", ["acp", "--cloud"], { stdio: ["pipe", "pipe", "ignore"] });
    const finish = (reply: CloudReply | null) => {
      clearTimeout(timer);
      child.kill();
      resolve(reply);
    };
    const timer = setTimeout(() => finish(null), 30_000);
    const send = (id: number, method: string, params: object) =>
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    child.on("error", () => finish(null));
    createInterface({ input: child.stdout }).on("line", (line) => {
      let msg: { id?: number } & CloudReply;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === 1) send(2, method, params);
      if (msg.id === 2) finish(msg.error ? { error: { code: msg.error.code } } : { result: msg.result });
    });
    send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
  });
}

/** Devin Cloud's models with a priority tier, from a throwaway cloud session (unlisted until prompted). */
async function probePriorityModels(): Promise<string[] | null> {
  const reply = await cloudRequest("session/new", { cwd: tmpdir(), mcpServers: [] });
  const raw = reply?.result?.configOptions?.find((o: { id?: string }) => o?.id === "devin_version");
  return raw ? priorityModels(raw) : null;
}

export const rpcContract = defineRpcContract({
  priorityModels: {
    input: z.null(),
    // null: unknown (Devin unreachable), so the picker keeps bb's own toggle.
    output: z.object({ names: z.array(z.string()).nullable() }),
  },
  session: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ url: z.string().nullable() }),
  },
  openVm: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

export default function devin(bb: BbPluginApi) {
  bb.providers.register(cloud);

  // Agent processes outlive a plugin reinstall and keep running the old relay. Stop idle
  // Devin Cloud threads on load so each starts the current one on its next message (same
  // Devin session). Never touches a running turn; stopping fires no load, so it can't loop.
  (async () => {
    let stopped = 0;
    for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({ limit: 100, offset });
      for (const thread of page) {
        if (thread.providerId !== CLOUD || thread.status !== "idle") continue;
        if (await bb.sdk.threads.stop({ threadId: thread.id }).then(() => true, () => false)) stopped++;
      }
      if (page.length < 100) break;
    }
    bb.log.info(`Stopped ${stopped} idle Devin Cloud threads`);
  })().catch(() => bb.log.warn("Couldn't stop idle Devin Cloud threads"));

  /** The thread's Devin Cloud session id (`devin-<hex>`), once it has one. */
  async function sessionIdOf(threadId: string): Promise<string | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== CLOUD) return null;
    const [identity] = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], order: "desc", limit: "1" });
    const id = (identity?.data as { providerThreadId?: string } | undefined)?.providerThreadId;
    return sessionUrl(id) === null ? null : id!;
  }
  const urlFor = async (threadId: string) => sessionUrl((await sessionIdOf(threadId)) ?? undefined);

  // ponytail: one in-flight check per thread; thread.active and thread.idle can land together.
  const inFlight = new Map<string, Promise<boolean>>();

  /** Opens the "Devin VM" terminal unless one is live. `force` also reopens one the user closed. */
  function ensureVm(threadId: string, force: boolean): Promise<boolean> {
    const running = inFlight.get(threadId);
    if (running) return running;
    const work = (async () => {
      const url = await urlFor(threadId);
      if (url === null) return false;
      bb.realtime.publish(SESSION_CHANNEL, { threadId });
      // Closed terminals drop out of terminals.list, so remember ours and ask for it by id.
      const { vmTerminalId } = await bb.sdk.threads.getPluginMetadata({ threadId });
      if (typeof vmTerminalId === "string") {
        const vm = await bb.sdk.terminals.get({ terminalId: vmTerminalId }).catch(() => null);
        if (vm?.status === "running" || vm?.status === "starting") return true;
        if (!force && vm?.closeReason === "user") return true;
      } else {
        // Nothing remembered (e.g. the plugin was renamed): adopt a running Devin VM terminal.
        const { sessions } = await bb.sdk.terminals.list({ scope: { kind: "thread", threadId } });
        const running = sessions.find((t) => t.title === VM_TITLE && (t.status === "running" || t.status === "starting"));
        if (running) {
          await bb.sdk.threads.updatePluginMetadata({ threadId, set: { vmTerminalId: running.id } });
          return true;
        }
      }
      const vm = await bb.sdk.terminals.create({
        scope: { kind: "thread", threadId },
        title: VM_TITLE,
        cols: 120,
        rows: 32,
        start: { mode: "command", command: VM_COMMAND(url) },
      });
      await bb.sdk.threads.updatePluginMetadata({ threadId, set: { vmTerminalId: vm.id } });
      return true;
    })().finally(() => inFlight.delete(threadId));
    inFlight.set(threadId, work);
    return work;
  }

  const onThread = ({ thread }: { thread: { id: string; providerId: string } }) => {
    if (thread.providerId !== CLOUD) return;
    ensureVm(thread.id, false).catch((error) => bb.log.warn(`Devin VM terminal for ${thread.id}: ${error}`));
  };
  bb.events.on("thread.active", onThread);
  bb.events.on("thread.idle", onThread);

  // Devin Cloud secret requests (tagged by the relay) → a bb form → _cognition.ai/secret/provide.
  // The value goes from the form straight to Devin: never into a transcript, log, or file.
  const asked = new Set<string>(); // secret request / question ids prompted by this process

  async function askSecret(threadId: string, request: SecretRequest): Promise<void> {
    const sessionId = await sessionIdOf(threadId);
    if (sessionId === null) return;
    let error: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await bb.ui.requestInput({
        threadId,
        rendererId: SECRET_FORM,
        title: request.name,
        payload: { name: request.name, note: request.note, save: request.save, error },
        timeoutMs: FORM_TIMEOUT_MS,
        presentation: { label: { pending: `Devin needs secret ${request.name}`, completed: `Sent ${request.name}` } },
      });
      if (result.outcome !== "submitted") return;
      const answer = (result.value ?? {}) as { value?: unknown; save?: unknown; skip?: unknown };
      if (answer.skip === true) {
        // Devin's ACP has no way to decline a secret request (provide rejects an empty list),
        // so tell Devin in the thread.
        await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text: `Skipped ${request.name}; continue without it.`, mentions: [] }] });
        return;
      }
      let params: object;
      if (typeof answer.value === "string" && answer.value !== "") {
        params = {
          session_id: sessionId,
          request_id: request.requestId,
          secret_name: request.name,
          secret_value: answer.value,
          // ponytail: "user" scope only; org/repo saving is left to Devin's web app.
          ...(answer.save === true ? { should_save: true, save_scope: "user" } : {}),
        };
      } else return;
      const reply = await cloudRequest("_cognition.ai/secret/provide", params);
      if (reply !== null && reply.error === undefined) return;
      bb.log.warn(`Devin didn't accept ${request.name} for ${threadId} (error ${reply?.error?.code ?? "no reply"})`);
      error = "Devin didn't accept it.";
    }
  }

  /** Devin's question as a bb form; the answer goes back as the user's message (Devin's ACP has no answer method). */
  async function askQuestion(threadId: string, question: DevinQuestion, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const result = await bb.ui.requestInput({
      threadId,
      rendererId: QUESTION_FORM,
      title: question.questions[0].question,
      payload: question,
      timeoutMs: FORM_TIMEOUT_MS,
      presentation: { label: { pending: "Devin asks", completed: "Answered Devin" } },
    }, { signal });
    if (result.outcome !== "submitted") return;
    const picks = (result.value as { picks?: unknown } | null)?.picks;
    if (!Array.isArray(picks)) return;
    const clean = picks.map((p) => (Array.isArray(p) ? p.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []));
    if (clean.every((p) => p.length === 0)) return;
    await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text: questionAnswer(question, clean), mentions: [] }] });
  }

  /** True the first time this id is seen for the thread; persisted so a restart doesn't ask again. */
  async function firstTime(threadId: string, key: "secretRequests" | "questions", id: string): Promise<boolean> {
    if (asked.has(id)) return false;
    asked.add(id);
    const meta = await bb.sdk.threads.getPluginMetadata({ threadId });
    const seen = Array.isArray(meta[key]) ? (meta[key] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (seen.includes(id)) return false;
    await bb.sdk.threads.updatePluginMetadata({ threadId, set: { [key]: [...seen, id] } });
    return true;
  }

  // bb shows one plugin form per thread at a time, so forms queue per thread. Devin keeps one
  // question open at a time, so a newer question withdraws the older one's form.
  const formQueue = new Map<string, Promise<void>>();
  const openQuestion = new Map<string, AbortController>();
  const enqueue = (threadId: string, what: string, run: () => Promise<void>) => {
    const next = (formQueue.get(threadId) ?? Promise.resolve())
      .then(run)
      .catch((error) => bb.log.warn(`Devin ${what} form for ${threadId}: ${error instanceof Error ? error.message : "failed"}`));
    formQueue.set(threadId, next);
  };

  async function findPrompts(threadId: string): Promise<void> {
    const events = await bb.sdk.threads.events.list({ threadId, types: ["item/started", "item/completed"], order: "desc", limit: "100" });
    let newest: DevinQuestion | null = null;
    for (const event of [...events].reverse()) {
      // Older than a form's lifetime: stale, even if this plugin's records don't say so (renamed plugin).
      if (Date.now() - event.createdAt > FORM_TIMEOUT_MS) continue;
      const args = (event.data as { item?: { arguments?: { devinSecretRequest?: SecretRequest; devinQuestion?: DevinQuestion } } }).item?.arguments;
      const request = args?.devinSecretRequest;
      if (request?.requestId && (await firstTime(threadId, "secretRequests", request.requestId))) {
        enqueue(threadId, "secret", () => askSecret(threadId, request));
      }
      const question = args?.devinQuestion;
      if (question?.id && (await firstTime(threadId, "questions", question.id))) newest = question;
    }
    if (newest === null) return;
    const question: DevinQuestion = newest;
    openQuestion.get(threadId)?.abort();
    const controller = new AbortController();
    openQuestion.set(threadId, controller);
    enqueue(threadId, "question", () => askQuestion(threadId, question, controller.signal));
  }

  const onThreadEvents = ({ thread }: { thread: { id: string; providerId: string } }) => {
    if (thread.providerId !== CLOUD) return;
    findPrompts(thread.id).catch(() => bb.log.warn(`Devin prompt check for ${thread.id} failed`));
  };
  bb.events.on("experimental_thread.events", onThreadEvents);
  bb.events.on("thread.idle", onThreadEvents);

  // ponytail: probed once per plugin load (retried after a failure); reload the plugin to pick up new models.
  let priority: Promise<string[] | null> | undefined;

  bb.rpc.register(rpcContract, {
    priorityModels: async () => {
      priority ??= probePriorityModels();
      const names = await priority;
      if (names === null) priority = undefined;
      return { names };
    },
    session: async ({ threadId }) => ({ url: await urlFor(threadId) }),
    openVm: async ({ threadId }) => {
      if (!(await ensureVm(threadId, true))) return { ok: false };
      const { vmTerminalId } = await bb.sdk.threads.getPluginMetadata({ threadId });
      if (typeof vmTerminalId !== "string") return { ok: false };
      // Show it in the thread's side panel; retried once if the tabs changed underneath.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { revision, tabs } = await bb.sdk.threads.tabs.get({ threadId });
        const next = withVmTab(tabs as Tab[], vmTab(threadId, vmTerminalId));
        if (next === null) break;
        const saved = await bb.sdk.threads.tabs
          .update({ threadId, expectedRevision: revision, tabs: next as never })
          .then(() => true, () => false);
        if (saved) break;
      }
      return { ok: true };
    },
  });

  bb.cli.register(
    defineCli({
      name: "devin",
      summary: "Devin Cloud sessions for bb threads",
      commands: {
        vm: cliCommand({
          summary: "Print a Devin Cloud thread's session URL and open its VM terminal",
          positionals: [{ name: "thread", description: "Thread id (defaults to the current thread)", required: false }],
          async run(input, ctx) {
            const threadId = input.positionals.thread ?? ctx?.threadId;
            if (!threadId) throw new PluginCliError("pass a thread id", { code: "no_thread" });
            if (!(await ensureVm(threadId, true))) {
              throw new PluginCliError("not a Devin Cloud thread with a session yet", {
                code: "no_session",
                hint: "Send the thread a message first.",
              });
            }
            return { exitCode: 0, stdout: `${await urlFor(threadId)}\nOpened terminal "${VM_TITLE}".` };
          },
        }),
      },
    }),
  );
}
