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
import { priorityModels } from "./relay.ts";

export const CLOUD = "devin-cloud";
export const SESSION_CHANNEL = "session";
const VM_TITLE = "Devin VM";
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

/** Devin web app URL for a cloud ACP session id (`devin-<hex>`). */
export function sessionUrl(providerThreadId: string | undefined): string | null {
  const hex = /^devin-([0-9a-f]+)$/.exec(providerThreadId ?? "")?.[1];
  return hex ? `https://app.devin.ai/sessions/${hex}` : null;
}

/** Devin Cloud's models with a priority tier, from a throwaway cloud session (unlisted until prompted). */
function probePriorityModels(): Promise<string[] | null> {
  return new Promise((resolve) => {
    const child = spawn("devin", ["acp", "--cloud"], { stdio: ["pipe", "pipe", "ignore"] });
    const finish = (names: string[] | null) => {
      clearTimeout(timer);
      child.kill();
      resolve(names);
    };
    const timer = setTimeout(() => finish(null), 30_000);
    const send = (id: number, method: string, params: object) =>
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    child.on("error", () => finish(null));
    createInterface({ input: child.stdout }).on("line", (line) => {
      let msg: { id?: number; result?: { configOptions?: { id?: string }[] } };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === 1) send(2, "session/new", { cwd: tmpdir(), mcpServers: [] });
      if (msg.id === 2) {
        const raw = msg.result?.configOptions?.find((o) => o?.id === "devin_version");
        finish(raw ? priorityModels(raw) : null);
      }
    });
    send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
  });
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

  async function urlFor(threadId: string): Promise<string | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== CLOUD) return null;
    const [identity] = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], order: "desc", limit: "1" });
    return sessionUrl((identity?.data as { providerThreadId?: string } | undefined)?.providerThreadId);
  }

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
    openVm: async ({ threadId }) => ({ ok: await ensureVm(threadId, true) }),
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
