import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { DEVIN_MARKETPLACE_URL, hostContract } from "./cli.ts";

const MAX_OUTPUT = 4 * 1024 * 1024; // host RPC output is capped at 8 MiB
const MAX_MANIFEST = 1024 * 1024;
const git = promisify(execFile);

async function readJson(path: string): Promise<unknown> {
  try {
    if ((await stat(path)).size > MAX_MANIFEST) return null;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

// Runs on the selected machine's daemon, so the agent CLIs read that machine's config.
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    run: ({ bin, args }, context) =>
      new Promise((resolve) => {
        // stdin closed: a CLI that wants to prompt fails instead of hanging.
        const child = spawn(bin, args, { cwd: homedir(), stdio: ["ignore", "pipe", "pipe"], signal: context.signal });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout = (stdout + d).slice(0, MAX_OUTPUT)));
        child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-64 * 1024)));
        child.on("error", (error: NodeJS.ErrnoException) =>
          resolve({ missing: error.code === "ENOENT", code: null, stdout, stderr: stderr || error.message }),
        );
        child.on("close", (code) => resolve({ missing: false, code, stdout, stderr }));
      }),

    readManifests: async ({ paths }) => Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await readJson(p)] as const))),

    // Devin's CLI can't list its marketplace, so keep a manifests-only checkout of the repo it
    // installs from (~2 MB) and refresh it on each call. A failed refresh serves the last copy.
    devinCatalog: async (_input, context) => {
      const dir = join(context.experimental_paths.dataDir, "devin-marketplace");
      const opts = { signal: context.signal, timeout: 60_000 };
      let error: string | null = null;
      try {
        if (!existsSync(join(dir, ".git"))) {
          await git("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", DEVIN_MARKETPLACE_URL, dir], opts);
          await git("git", ["-C", dir, "sparse-checkout", "set", "--no-cone", "/plugins/*/.devin-plugin/plugin.json"], opts);
        } else {
          await git("git", ["-C", dir, "fetch", "--quiet", "--depth", "1", "origin", "HEAD"], opts);
          await git("git", ["-C", dir, "reset", "--quiet", "--hard", "FETCH_HEAD"], opts);
        }
      } catch (e) {
        error = `Couldn't refresh ${DEVIN_MARKETPLACE_URL}: ${e instanceof Error ? e.message.split("\n")[0] : e}`;
      }
      const dirs = await readdir(join(dir, "plugins")).catch(() => [] as string[]);
      const manifests = Object.fromEntries(
        await Promise.all(dirs.map(async (d) => [d, await readJson(join(dir, "plugins", d, ".devin-plugin", "plugin.json"))] as const)),
      );
      return { manifests, error };
    },
  },
});
