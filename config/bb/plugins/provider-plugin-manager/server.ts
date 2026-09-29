import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  actionArgv,
  actionSchema,
  BIN,
  claudeManifestPaths,
  claudeMarketplaceRoots,
  claudePluginDirs,
  codexManifestPaths,
  FEATURES,
  hostContract,
  iconManifestPaths,
  LIST,
  loginArgv,
  mcpName,
  NOTES,
  parseCatalog,
  parseDevinCatalog,
  parseMarketplaces,
  parseMcp,
  parsePlugins,
  PROVIDER_AGENTS,
  queryStore,
  redact,
  shellQuote,
  VERSION_ARGS,
  type Agent,
  type Entry,
  type IconRef,
  type Marketplace,
  type McpServer,
  type Plugin,
} from "./cli.ts";

const target = z.object({ providerId: z.string().min(1).max(100), hostId: z.string().min(1).max(100) }).strict();
const terminal = z.object({ terminalId: z.string().min(1).max(200) }).strict();
const loose = z.any(); // server-built output; the types below describe it for the app

export const rpcContract = defineRpcContract({
  machines: { input: z.null(), output: loose },
  state: { input: target, output: loose },
  store: {
    input: target.extend({
      query: z.string().max(200),
      category: z.string().max(100).nullable(),
      marketplace: z.string().max(200).nullable(),
      unavailable: z.boolean(),
      offset: z.number().int().min(0).max(100_000),
      refresh: z.boolean(),
    }),
    output: loose,
  },
  entry: { input: target.extend({ id: z.string().min(1).max(500) }), output: loose },
  mcp: { input: target, output: loose },
  act: { input: target.extend({ action: actionSchema }), output: loose },
  login: { input: target.extend({ server: mcpName }), output: loose },
  icons: {
    input: z.object({ hostId: z.string().min(1).max(100), refs: z.array(z.object({ base: z.string().max(1000), rel: z.string().max(300) }).strict()).max(100) }).strict(),
    output: z.array(z.string().nullable()),
  },
  terminalOutput: { input: terminal.extend({ sinceSeq: z.number().int().min(0) }), output: loose },
  terminalInput: { input: terminal.extend({ text: z.string().max(4000) }), output: loose },
  terminalClose: { input: terminal, output: loose },
  restartIdle: { input: target, output: loose },
});

export type Machine = { id: string; name: string; connected: boolean };
/** An installed plugin with what the store knows about it. */
export type InstalledPlugin = Plugin & { displayName: string; description: string; categories: string[]; homepage: string | null; icon: IconRef | null };
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
      plugins: InstalledPlugin[] | null;
      marketplaces: Marketplace[] | null;
      errors: string[];
    };
export type StorePage = ReturnType<typeof queryStore> & { error: string | null };
export type ActResult = { ok: boolean; output: string };
export type McpResult = { servers: McpServer[]; error: string | null };
export type LoginResult = { terminalId: string; title: string };
export type TerminalChunk = { text: string; nextSeq: number; running: boolean; exitCode: number | null };

const PAGE = 48;
const CATALOG_TTL_MS = 10 * 60_000;
const failure = (r: { code: number | null; stdout: string; stderr: string }) =>
  redact(r.stderr || r.stdout) || `exited with code ${r.code}`;
const title = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  const run = (hostId: string, agent: Agent, args: string[], timeoutMs = 60_000) =>
    host.call("run", { bin: BIN[agent], args }, { hostId, timeoutMs });

  /** stdout, or throws the CLI's (redacted) error. */
  async function output(hostId: string, agent: Agent, args: string[]): Promise<string> {
    const r = await run(hostId, agent, args);
    if (r.missing) throw new Error(`${BIN[agent]} isn't installed on this machine.`);
    if (r.code !== 0) throw new Error(`${BIN[agent]} ${args.join(" ")}: ${failure(r)}`);
    return r.stdout;
  }

  const agentOf = (providerId: string): Agent | null => PROVIDER_AGENTS[providerId] ?? null;
  const errorText = (e: unknown) => redact(e instanceof Error ? e.message : String(e));

  // ponytail: per-machine catalog cache in memory, dropped after any change; a plugin reload clears it.
  const catalogs = new Map<string, { at: number; entries: Entry[]; error: string | null }>();

  async function catalog(hostId: string, agent: Agent, refresh = false): Promise<{ entries: Entry[]; error: string | null }> {
    const key = `${hostId}:${agent}`;
    const cached = catalogs.get(key);
    if (!refresh && cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached;
    let result: { entries: Entry[]; error: string | null };
    try {
      if (agent === "claude") {
        const [list, markets] = await Promise.all([output(hostId, agent, LIST.catalog.claude), output(hostId, agent, LIST.marketplaces.claude)]);
        const paths = claudeManifestPaths(markets);
        const read = await host.call("readManifests", { paths: Object.values(paths) }, { hostId });
        const manifests = Object.fromEntries(Object.entries(paths).map(([market, path]) => [market, read[path] ?? null]));
        // Claude manifests name no icon; a plugin's Codex/Cursor manifest often does.
        const dirs = claudePluginDirs(list, manifests, claudeMarketplaceRoots(markets));
        const icons = await host.call("readManifests", { paths: iconManifestPaths(Object.values(dirs)).slice(0, 800) }, { hostId });
        result = { entries: parseCatalog(agent, list, manifests, { dirs, read: icons }), error: null };
      } else if (agent === "codex") {
        const list = await output(hostId, agent, LIST.catalog.codex);
        const manifests = await host.call("readManifests", { paths: codexManifestPaths(list).slice(0, 500) }, { hostId });
        result = { entries: parseCatalog(agent, list, manifests), error: null };
      } else if (agent === "devin") {
        const [devin, installed] = await Promise.all([
          host.call("devinCatalog", null, { hostId, timeoutMs: 120_000 }),
          output(hostId, agent, LIST.plugins.devin),
        ]);
        const names = new Set(parsePlugins(agent, installed).map((p) => p.name));
        result = { entries: parseDevinCatalog(devin.manifests, names), error: devin.error ? redact(devin.error) : null };
      } else {
        result = { entries: [], error: null };
      }
    } catch (e) {
      return { entries: cached?.entries ?? [], error: errorText(e) };
    }
    catalogs.set(key, { at: Date.now(), ...result });
    for (const e of result.entries) if (e.icon && "base" in e.icon) issued.add(iconKey(hostId, e.icon));
    return result;
  }

  // Icon files the catalogs named, per machine: the app may only fetch these.
  const issued = new Set<string>();
  const iconKey = (hostId: string, icon: { base: string; rel: string }) => `${hostId}\n${icon.base}\n${icon.rel}`;

  /** The icon of the plugin an MCP server came from (Claude says; elsewhere, a same-named plugin). */
  function serverIcons(agent: Agent, servers: McpServer[], entries: Entry[]): McpServer[] {
    const installed = entries.filter((e) => e.installed && e.icon);
    const byName = new Map(installed.map((e) => [e.name, e.icon]));
    return servers.map((s) => ({
      ...s,
      icon:
        (s.plugin ? byName.get(s.plugin) : undefined) ??
        installed.find((e) => e.mcpServers.includes(s.name))?.icon ??
        (agent !== "claude" ? byName.get(s.name) : undefined) ??
        null,
    }));
  }

  /** Installed rows joined with their store listing (description, display name, categories). */
  function describe(agent: Agent, plugins: Plugin[], entries: Entry[]): InstalledPlugin[] {
    const byKey = new Map(entries.map((e) => [agent === "devin" ? e.name : e.id, e]));
    return plugins.map((p) => {
      const e = byKey.get(agent === "devin" ? p.name : p.id);
      return {
        ...p,
        displayName: e?.displayName ?? title(p.name),
        description: e?.description ?? "",
        categories: e?.categories ?? [],
        homepage: e?.homepage ?? null,
        icon: e?.icon ?? null,
        source: p.source || e?.marketplace || "",
      };
    });
  }

  // Terminals this plugin opened: the app may only read or type into these.
  const terminals = new Set<string>();

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
      const [plugins, marketplaces, store] = await Promise.all([
        read((LIST.plugins as Partial<Record<Agent, string[]>>)[agent], (s) => parsePlugins(agent, s)),
        read((LIST.marketplaces as Partial<Record<Agent, string[]>>)[agent], (s) => parseMarketplaces(agent, s)),
        FEATURES[agent].store ? catalog(hostId, agent) : Promise.resolve({ entries: [], error: null }),
      ]);
      return {
        agent,
        bin: BIN[agent],
        missing: false,
        version: redact(probe.stdout).split("\n")[0],
        features: FEATURES[agent],
        note: NOTES[agent] ?? null,
        plugins: plugins && describe(agent, plugins, store.entries),
        marketplaces,
        errors,
      };
    },

    store: async ({ providerId, hostId, refresh, ...query }): Promise<StorePage> => {
      const agent = agentOf(providerId);
      if (!agent || !FEATURES[agent].store) {
        return { ...queryStore([], { ...query, limit: PAGE }), error: "This agent has no plugin catalog its CLI can install from." };
      }
      const { entries, error } = await catalog(hostId, agent, refresh);
      return { ...queryStore(entries, { ...query, limit: PAGE }), error };
    },

    entry: async ({ providerId, hostId, id }): Promise<Entry | null> => {
      const agent = agentOf(providerId);
      if (!agent || !FEATURES[agent].store) return null;
      const { entries } = await catalog(hostId, agent);
      return entries.find((e) => e.id === id || (agent === "devin" && e.name === id)) ?? null;
    },

    mcp: async ({ providerId, hostId }): Promise<McpResult> => {
      const agent = agentOf(providerId);
      if (!agent) return { servers: [], error: "Not supported for this agent." };
      try {
        // Claude health-checks every server; that can take a while.
        const r = await run(hostId, agent, LIST.mcp[agent], 120_000);
        if (r.missing) return { servers: [], error: `${BIN[agent]} isn't installed on this machine.` };
        if (r.code !== 0) return { servers: [], error: failure(r) };
        const entries = FEATURES[agent].store ? (await catalog(hostId, agent)).entries : [];
        return { servers: serverIcons(agent, parseMcp(agent, r.stdout), entries), error: null };
      } catch (e) {
        return { servers: [], error: errorText(e) };
      }
    },

    act: async ({ providerId, hostId, action }): Promise<ActResult> => {
      const agent = agentOf(providerId);
      const args = agent && actionArgv(agent, action);
      if (!agent || !args) return { ok: false, output: "This agent's CLI doesn't support that." };
      // Installs and updates clone repos; give them time.
      const r = await run(hostId, agent, args, 10 * 60_000);
      bb.log.info(`${BIN[agent]} ${args.slice(0, 2).join(" ")} on ${hostId}: exit ${r.code}`);
      if (r.code === 0) catalogs.delete(`${hostId}:${agent}`);
      return r.code === 0 ? { ok: true, output: redact(r.stdout || r.stderr) } : { ok: false, output: failure(r) };
    },

    // Browser/OAuth logins need a real TTY: run them in a bb terminal on that machine.
    login: async ({ providerId, hostId, server }): Promise<LoginResult> => {
      const agent = agentOf(providerId);
      if (!agent) throw new Error("Not supported for this agent.");
      const label = `${BIN[agent]} mcp login ${server}`;
      const session = await bb.sdk.terminals.create({
        scope: { kind: "host_path", hostId, cwd: null },
        title: label,
        cols: 100,
        rows: 30,
        start: { mode: "command", command: [BIN[agent], ...loginArgv(server)].map(shellQuote).join(" ") },
      });
      terminals.add(session.id);
      bb.log.info(`Opened terminal ${session.id} for ${label} on ${hostId}`);
      return { terminalId: session.id, title: label };
    },

    icons: async ({ hostId, refs }) => {
      const allowed = refs.map((r) => issued.has(iconKey(hostId, r)));
      const wanted = refs.filter((_, i) => allowed[i]);
      const read = wanted.length ? await host.call("readIcons", { refs: wanted }, { hostId }) : [];
      let next = 0;
      return allowed.map((ok) => (ok ? (read[next++] ?? null) : null));
    },

    terminalOutput: async ({ terminalId, sinceSeq }): Promise<TerminalChunk> => {
      if (!terminals.has(terminalId)) return { text: "", nextSeq: sinceSeq, running: false, exitCode: null };
      const out = await bb.sdk.terminals.output({ terminalId, sinceSeq, tailBytes: 64 * 1024 });
      const text = out.chunks.map((c) => Buffer.from(c.dataBase64, "base64").toString("utf8")).join("");
      return { text: redact(text, 64 * 1024), nextSeq: out.nextSeq, running: out.status === "running" || out.status === "starting", exitCode: out.exitCode };
    },

    terminalInput: async ({ terminalId, text }) => {
      if (!terminals.has(terminalId)) throw new Error("That terminal isn't open any more.");
      await bb.sdk.terminals.input({ terminalId, dataBase64: Buffer.from(text, "utf8").toString("base64") });
      return { ok: true };
    },

    terminalClose: async ({ terminalId }) => {
      if (!terminals.delete(terminalId)) return { ok: true };
      await bb.sdk.terminals.close({ terminalId, mode: "force" }).catch(() => {});
      return { ok: true };
    },

    // Plugins and MCP servers load when an agent process starts. Stopping an idle thread ends its
    // process; its next message starts a new one (same conversation) with the current config.
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
