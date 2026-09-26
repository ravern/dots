import { useCallback, useEffect, useState } from "react";
import { definePluginApp, UrlLink, useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

const button =
  "inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";

/** "Devin ↗" (web app) and "VM" (terminal) for Devin Cloud threads; nothing elsewhere. */
function DevinSession({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [url, setUrl] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc.call("session", { threadId }).then((r) => setUrl(r.url), () => {});
  }, [rpc, threadId]);
  useEffect(refresh, [refresh]);
  useRealtime("session", (event) => {
    if ((event as { threadId?: string } | null)?.threadId === threadId) refresh();
  });
  if (url === null) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <UrlLink href={url} className={button} title="Open this session in Devin's web app">
        Devin ↗
      </UrlLink>
      <button type="button" className={button} title="Open a terminal on the Devin VM" onClick={() => rpc.call("openVm", { threadId })}>
        VM
      </button>
    </span>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({ id: "devin-session", title: "Devin Cloud session", component: DevinSession });
});
