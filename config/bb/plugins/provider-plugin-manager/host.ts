import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./cli.ts";

const MAX_OUTPUT = 4 * 1024 * 1024; // host RPC output is capped at 8 MiB

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
  },
});
