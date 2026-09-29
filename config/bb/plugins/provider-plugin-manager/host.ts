import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { DEVIN_MARKETPLACE_URL, hostContract, IMAGE } from "./cli.ts";

const MAX_OUTPUT = 4 * 1024 * 1024; // host RPC output is capped at 8 MiB
const MAX_MANIFEST = 1024 * 1024;
const MAX_ICON = 256 * 1024;
const git = promisify(execFile);
const home = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const DEVIN_SPARSE = ["/plugins/*/.devin-plugin/plugin.json", "/plugins/*/logo.*"];

const MIME: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
/** Whether the bytes are really the image type the extension claims. */
function looksLike(ext: string, b: Buffer): boolean {
  if (ext === ".png") return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (ext === ".jpg" || ext === ".jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === ".gif") return b.subarray(0, 4).toString("latin1") === "GIF8";
  if (ext === ".webp") return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  return /<svg[\s>]/i.test(b.subarray(0, 4096).toString("utf8")); // shown via <img>, so scripts never run
}

/**
 * An icon as a data URL, or null. The file must be an image (by name and bytes), at most 256 KB,
 * and inside `base` after resolving symlinks. `@devin/<dir>` is a plugin in this host's
 * checkout of Devin's marketplace.
 */
async function readIcon(base: string, rel: string, dataDir: string): Promise<string | null> {
  const devin = base.startsWith("@devin/") ? base.slice(7) : null;
  if (devin !== null && !/^(?!\.+$)[\w.-]+$/.test(devin)) return null;
  const root = devin !== null ? join(dataDir, "devin-marketplace", "plugins", devin) : home(base);
  if (!isAbsolute(root) || !IMAGE.test(rel)) return null;
  try {
    const realRoot = await realpath(root);
    const file = await realpath(resolve(realRoot, rel));
    if (!file.startsWith(realRoot + sep)) return null;
    const ext = extname(file).toLowerCase();
    const info = await stat(file);
    if (!MIME[ext] || !info.isFile() || info.size > MAX_ICON) return null;
    const bytes = await readFile(file);
    return looksLike(ext, bytes) ? `data:${MIME[ext]};base64,${bytes.toString("base64")}` : null;
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<unknown> {
  path = home(path);
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

    readIcons: async ({ refs }, context) => Promise.all(refs.map((r) => readIcon(r.base, r.rel, context.experimental_paths.dataDir))),

    // Devin's CLI can't list its marketplace, so keep a partial checkout of the repo it installs
    // from and refresh it on each call. A failed refresh serves the last copy.
    devinCatalog: async (_input, context) => {
      const dir = join(context.experimental_paths.dataDir, "devin-marketplace");
      const opts = { signal: context.signal, timeout: 60_000 };
      let error: string | null = null;
      try {
        if (!existsSync(join(dir, ".git"))) {
          await git("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", DEVIN_MARKETPLACE_URL, dir], opts);
        } else {
          await git("git", ["-C", dir, "fetch", "--quiet", "--depth", "1", "origin", "HEAD"], opts);
          await git("git", ["-C", dir, "reset", "--quiet", "--hard", "FETCH_HEAD"], opts);
        }
        // Manifests and logos only (~4 MB); reapplied so older checkouts pick up the logos.
        await git("git", ["-C", dir, "sparse-checkout", "set", "--no-cone", ...DEVIN_SPARSE], opts);
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
