import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
  type PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const CLOUD = "devin-cloud";
export const SESSION_CHANNEL = "session";
const VM_TITLE = "Devin VM";
// Land in the session's repo: the relay picks at most one, cloned under ~/repos.
const VM_COMMAND = (url: string) => `devin ssh ${url} -t 'cd ~/repos/*/ 2>/dev/null; exec "$SHELL" -l'`;

// Devin works on its own VM and never asks bb for permission, so Full access is the only mode.
// The model picker lists Devin Cloud's versions (tagged by the relay); there is no reasoning knob.
const cloud: PluginProviderDeclaration = {
  id: CLOUD,
  displayName: "Devin Cloud",
  icon: "./icons/cognition.svg",
  experimental_bridgeOptions: {
    acpLaunchSpec: { displayName: "Devin Cloud", command: "devin", args: ["acp", "--cloud"], env: {} },
    acpDialect: "generic",
  },
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["full"],
    reasoningLevels: ["medium"],
  },
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

export const rpcContract = defineRpcContract({
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

  bb.rpc.register(rpcContract, {
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
