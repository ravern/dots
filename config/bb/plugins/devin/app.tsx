import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  UrlLink,
  useRealtime,
  useRpc,
  type PluginPendingInteractionProps,
  type PluginRpcClient,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner"; // shimmed to bb's toaster
import { devinModelFromTitle, hasPriority, relabel } from "./labels.ts";
import type { DevinQuestion } from "./relay.ts";
import type { rpcContract } from "./server";

const button =
  "inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";

/** "Open in Devin" (the session in Devin's web app) for Devin Cloud threads; nothing elsewhere. */
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
    <UrlLink href={url} className={button} title="Open this session in Devin's web app">
      Open in Devin
    </UrlLink>
  );
}

/** bb's prompt for a Devin Cloud secret request; the server hands the value to Devin. */
function SecretForm({ interaction, submit }: PluginPendingInteractionProps) {
  const payload = interaction.payload as { name: string; note: string; save?: boolean; error: string | null };
  const { name, note, error } = payload;
  const [value, setValue] = useState("");
  const [save, setSave] = useState(payload.save === true);
  return (
    <form
      className="flex flex-col gap-2 p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== "") void submit({ value, save });
      }}
    >
      {note ? <div className="text-muted-foreground">{note}</div> : null}
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label={name}
        placeholder={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 rounded-md border border-border bg-transparent px-2 font-mono"
        autoFocus
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />
        Save for future sessions
      </label>
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={value === ""} className={`${button} border border-border text-foreground disabled:opacity-50`}>
          Send
        </button>
        <button type="button" onClick={() => void submit({ skip: true })} className={button}>
          Skip
        </button>
      </div>
    </form>
  );
}

/** Devin's multiple-choice question; the picks go back as the user's answer. */
function QuestionForm({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const { questions } = interaction.payload as DevinQuestion;
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const answers = picks;
  const toggle = (i: number, option: string, multiple: boolean) =>
    setPicks((all) =>
      all.map((p, j) => (j !== i ? p : multiple ? (p.includes(option) ? p.filter((o) => o !== option) : [...p, option]) : [option])),
    );
  return (
    <form
      className="flex flex-col gap-3 p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (answers.some((a) => a.length > 0)) void submit({ picks: answers });
      }}
    >
      {questions.map((q, i) => (
        <fieldset key={i} className="flex flex-col gap-1">
          <legend className="mb-1">{q.question}</legend>
          {q.options.map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input
                type={q.multiple ? "checkbox" : "radio"}
                name={`${interaction.id}-${i}`}
                checked={picks[i].includes(option)}
                onChange={() => toggle(i, option, q.multiple)}
              />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      <div className="flex gap-2">
        <button type="submit" disabled={answers.every((a) => a.length === 0)} className={`${button} border border-border text-foreground disabled:opacity-50`}>
          Send
        </button>
        <button type="button" onClick={() => void cancel()} className={button}>
          Skip
        </button>
      </div>
    </form>
  );
}

const EDITABLE = 'input, textarea, [contenteditable="true"], .ProseMirror';
const ATTRS = ["aria-label", "title"];
const OPEN_TRIGGER = 'button[aria-label^="Provider, model and reasoning"][aria-expanded="true"]';
const PICKER_MENU = "[data-bb-portaled-overlay]";
// Other plugins (customize-model-names' compact picker) read this: "available" | "unavailable".
const PRIORITY_ATTR = "data-devin-priority";
const HIDDEN_ATTR = "data-devin-priority-hidden";

/**
 * Devin Cloud's service-tier toggle in the live DOM: relabels "Priority mode" / "(Fast mode)"
 * to "Priority", and hides the toggle row when the picked model has no priority tier
 * (`priority` null = unknown: leave bb's toggle alone). Returns a restorer.
 */
function startPriority(priority: readonly string[] | null): () => void {
  const texts = new Map<Text, string>();
  const attrs = new Map<Element, Map<string, string>>();
  const visitText = (node: Text) => {
    if (node.parentElement === null || node.parentElement.closest(EDITABLE) !== null) return;
    const next = relabel(node.data);
    if (next === node.data) return;
    texts.set(node, node.data);
    node.data = next;
  };
  const visitAttrs = (el: Element) => {
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (value === null || relabel(value) === value) continue;
      if (!attrs.has(el)) attrs.set(el, new Map());
      attrs.get(el)!.set(name, value);
      el.setAttribute(name, relabel(value));
    }
  };
  const scan = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return visitText(root as Text);
    if (!(root instanceof Element)) return;
    visitAttrs(root);
    for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) visitAttrs(el);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) visitText(n as Text);
  };
  const setHidden = (el: Element | null | undefined, hidden: boolean) => {
    if (!(el instanceof HTMLElement) || hidden === el.hasAttribute(HIDDEN_ATTR)) return;
    el.toggleAttribute(HIDDEN_ATTR, hidden);
    el.style.display = hidden ? "none" : "";
  };
  // bb renders the toggle as: <div border-t/> <div p-1><div row><span>label</span><switch aria-label/></div></div>
  const markToggles = () => {
    // bb puts the "Devin Cloud: SWE-2 · High reasoning" title on a span inside the trigger.
    const trigger = document.querySelector(OPEN_TRIGGER);
    const title = trigger?.getAttribute("title") ?? trigger?.querySelector("span[title]")?.getAttribute("title") ?? "";
    const model = devinModelFromTitle(title);
    // Unknown model (or unknown priority list): leave bb's switch alone.
    const state = priority === null || model === null || hasPriority(model, priority) ? "available" : "unavailable";
    for (const toggle of document.querySelectorAll('[aria-label="Priority"], [aria-label="Priority mode"]')) {
      for (const el of [toggle, toggle.closest(PICKER_MENU)]) {
        if (el && el.getAttribute(PRIORITY_ATTR) !== state) el.setAttribute(PRIORITY_ATTR, state);
      }
      const box = toggle.parentElement?.parentElement;
      setHidden(box, state === "unavailable");
      const separator = box?.previousElementSibling;
      if (separator?.classList.contains("border-t")) setHidden(separator, state === "unavailable");
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") m.addedNodes.forEach(scan);
      else if (m.type === "attributes") visitAttrs(m.target as Element);
      else visitText(m.target as Text);
    }
    markToggles();
    observer.takeRecords(); // drop records caused by our own writes
  });
  scan(document.body);
  markToggles();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS, "aria-expanded"],
  });
  return () => {
    observer.disconnect();
    for (const [node, text] of texts) if (node.isConnected && node.data === relabel(text)) node.data = text;
    for (const [el, saved] of attrs) for (const [name, value] of saved) if (el.getAttribute(name) === relabel(value)) el.setAttribute(name, value);
    for (const el of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) setHidden(el, false);
    for (const el of document.querySelectorAll(`[${PRIORITY_ATTR}]`)) el.removeAttribute(PRIORITY_ATTR);
  };
}

// The panel launcher's `run` gets no RPC client; the always-mounted overlay lends it one.
let appRpc: PluginRpcClient<typeof rpcContract> | null = null;

/** Renders nothing: keeps Devin Cloud's Priority toggle labelled, and shown only where it applies. */
function PriorityToggle() {
  const rpc = useRpc<typeof rpcContract>();
  appRpc = rpc;
  const [priority, setPriority] = useState<readonly string[] | null>(null);
  useEffect(() => {
    rpc.call("priorityModels", null).then((r) => setPriority(r.names), () => {});
  }, [rpc]);
  useEffect(() => startPriority(priority), [priority]);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({ id: "devin-session", title: "Devin Cloud session", component: DevinSession });
  app.slots.experimental_appOverlay({ id: "priority-toggle", component: PriorityToggle });
  app.slots.threadPanelAction({
    id: "devin-vm",
    title: "Start Devin terminal",
    icon: "Terminal",
    // Never opened: `run` opens the VM terminal tab instead of a plugin panel.
    component: () => null,
    async run({ threadId }) {
      const result = await appRpc?.call("openVm", { threadId });
      if (!result?.ok) toast("Start Devin terminal needs a Devin Cloud thread with a session.");
    },
  });
  app.slots.pendingInteraction({ id: "devin-secret", component: SecretForm });
  app.slots.pendingInteraction({ id: "devin-question", component: QuestionForm });
});
