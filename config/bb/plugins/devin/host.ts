import { fileURLToPath } from "node:url";
import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_acpProviderBridge as acp } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { RELAY_FLAG, runRelay } from "./relay.ts";

// This artifact doubles as the cloud relay: the bridge launches it again with RELAY_FLAG.
const relayAt = process.argv.indexOf(RELAY_FLAG);
if (relayAt >= 0) runRelay(process.argv.slice(relayAt + 1));

const self = fileURLToPath(import.meta.url);

/** Routes every `devin acp --cloud` launch spec in a request through the relay. */
export function relayCloudLaunches(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const spec = (value as { acpLaunchSpec?: { command: string; args: string[]; env: Record<string, string> } }).acpLaunchSpec;
  if (spec?.args?.includes("--cloud") && !spec.args.includes(RELAY_FLAG)) {
    spec.args = [self, RELAY_FLAG, spec.command, ...spec.args];
    spec.command = process.execPath; // bb's own runtime, run as plain node
    spec.env = { ...spec.env, ELECTRON_RUN_AS_NODE: "1" };
  }
  for (const child of Object.values(value)) relayCloudLaunches(child);
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine(line) {
    if (!line.includes("--cloud")) return acp.handleLine(line);
    const msg = JSON.parse(line);
    relayCloudLaunches(msg);
    acp.handleLine(JSON.stringify(msg));
  },
  start: (ctx) => acp.start?.(ctx),
  onClose: () => acp.onClose?.(),
  onSigterm: () => acp.onSigterm?.(),
  onSigint: () => acp.onSigint?.(),
});
