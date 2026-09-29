import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  actionArgv,
  actionSchema,
  BIN,
  FEATURES,
  hostContract,
  LIST,
  NOTES,
  parseAvailable,
  parseMarketplaces,
  parsePlugins,
  PROVIDER_AGENTS,
  redact,
  VERSION_ARGS,
  type Agent,
  type Marketplace,
  type Plugin,
} from "./cli.ts";

const target = z.object({ providerId: z.string().min(1).max(100), hostId: z.string().min(1).max(100) }).strict();
const loose = z.any(); // server-built output; the contract types it for the app below

export const rpcContract = defineRpcContract({
  machines: { input: z.null(), output: loose },
  state: { input: target, output: loose },
  available: { input: target.extend({ query: z.string().max(200) }), output: loose },
  act: { input: target.extend({ action: actionSchema }), output: loose },
  restartIdle: { input: target, output: loose },
});

export type Machine = { id: string; name: string; connected: boolean };
export type State =
  | { agent: null }
  | { agent: Agent; bin: string; missing: true }
  | {
      agent: Agent;
      bin: string;
      missing: false;
      version: string;
      features: (typeof FEATURES)[Agent];
      note: string | null;
      plugins: Plugin[] | null;
      marketplaces: Marketplace[] | null;
      errors: string[];
    };
export type ActResult = { ok: boolean; output: string };

const failure = (r: { code: number | null; stdout: string; stderr: string }) =>
  redact(r.stderr || r.stdout) || `exited with code ${r.code}`;

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  const run = (hostId: string, agent: Agent, args: string[], timeoutMs = 60_000) =>
    host.call("run", { bin: BIN[agent], args }, { hostId, timeoutMs });

  /** stdout, or throws the CLI's (redacted) error. */
  async function output(hostId: string, agent: Agent, args: string[]): Promise<string> {
    const r = await run(hostId, agent, args);
    if (r.code !== 0) throw new Error(`${BIN[agent]} ${args.join(" ")}: ${failure(r)}`);
    return r.stdout;
  }

  const agentOf = (providerId: string): Agent | null => PROVIDER_AGENTS[providerId] ?? null;
  const errorText = (e: unknown) => redact(e instanceof Error ? e.message : String(e));

  bb.rpc.register(rpcContract, {
    machines: async (): Promise<{ machines: Machine[]; defaultId: string | null }> => {
      const [hosts, config] = await Promise.all([bb.sdk.hosts.list(), bb.sdk.system.config()]);
      const machines = hosts
        .filter((h) => h.lifecycle.phase === "active")
        .map((h) => ({ id: h.id, name: h.name, connected: h.status === "connected" }));
      return { machines, defaultId: config.primaryHostId ?? machines.find((m) => m.connected)?.id ?? null };
    },

    state: async ({ providerId, hostId }): Promise<State> => {
      const agent = agentOf(providerId);
      if (agent === null) return { agent: null };
      const probe = await run(hostId, agent, VERSION_ARGS, 20_000);
      if (probe.missing) return { agent, bin: BIN[agent], missing: true };
      const errors: string[] = [];
      const read = async <T>(args: string[] | undefined, parse: (stdout: string) => T): Promise<T | null> => {
        if (args === undefined) return null;
        try {
          return parse(await output(hostId, agent, args));
        } catch (e) {
          errors.push(errorText(e));
          return null;
        }
      };
      const [plugins, marketplaces] = await Promise.all([
        read((LIST.plugins as Partial<Record<Agent, string[]>>)[agent], (s) => parsePlugins(agent, s)),
        read((LIST.marketplaces as Partial<Record<Agent, string[]>>)[agent], (s) => parseMarketplaces(agent, s)),
      ]);
      return {
        agent,
        bin: BIN[agent],
        missing: false,
        version: redact(probe.stdout).split("\n")[0],
        features: FEATURES[agent],
        note: NOTES[agent] ?? null,
        plugins,
        marketplaces,
        errors,
      };
    },

    available: async ({ providerId, hostId, query }) => {
      const agent = agentOf(providerId);
      const args = agent && (LIST.available as Partial<Record<Agent, string[]>>)[agent];
      if (!agent || !args) return { items: [], total: 0, error: "This agent's CLI can't browse marketplaces." };
      try {
        return { ...parseAvailable(agent, await output(hostId, agent, args), query, 100), error: null };
      } catch (e) {
        return { items: [], total: 0, error: errorText(e) };
      }
    },

    act: async ({ providerId, hostId, action }): Promise<ActResult> => {
      const agent = agentOf(providerId);
      const args = agent && actionArgv(agent, action);
      if (!agent || !args) return { ok: false, output: "This agent's CLI doesn't support that." };
      // Installs and updates clone repos; give them time.
      const r = await run(hostId, agent, args, 10 * 60_000);
      bb.log.info(`${BIN[agent]} ${args[0]} ${args[1]} ${args[2] ?? ""} on ${hostId}: exit ${r.code}`);
      return r.code === 0 ? { ok: true, output: redact(r.stdout || r.stderr) } : { ok: false, output: failure(r) };
    },

    // Plugins load when an agent process starts. Stopping an idle thread ends its process; its
    // next message starts a new one (same conversation) with the current plugins.
    restartIdle: async ({ providerId, hostId }) => {
      let stopped = 0;
      let busy = 0;
      for (let offset = 0; ; offset += 100) {
        const page = await bb.sdk.threads.list({ hostId, limit: 100, offset });
        for (const thread of page) {
          if (thread.providerId !== providerId) continue;
          if (thread.status === "active" || thread.status === "starting") busy++;
          if (thread.status !== "idle") continue;
          if (await bb.sdk.threads.stop({ threadId: thread.id }).then(() => true, () => false)) stopped++;
        }
        if (page.length < 100) break;
      }
      return { stopped, busy };
    },
  });
}
