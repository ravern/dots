// Text rules shared by the CLI validation (tasks.ts) and the panel (app.tsx).
// No zod or SDK imports, so the app bundle can use it at runtime.

const MD_LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;
const PATH_LIKE =
  /^(?:~?\/|\.\.?\/)\S|\.(?:md|mdx|ts|tsx|js|jsx|mjs|cjs|css|scss|json|jsonl|html|py|sh|ya?ml|toml|txt|log|csv|png|jpe?g|gif|svg|pdf|lock)$/i;
/** A thread reference: `@thread:thr_…` or a bare `thr_…`. */
const THREAD_REF = /(?:@thread:)?\b(thr_[a-z0-9]+)\b/g;
/** Other bb ids have no chip (automation, project, env, host, interaction, section, task, …). */
const OTHER_ID = /\b(?:auto|proj|env|host|pint|sec|t|term)_[a-z0-9]{6,}\b/g;

/** Text a reader sees: link text kept, link targets dropped. */
const visible = (text: string) => text.replace(MD_LINK, "$1");

/** Words a reader sees: link text counts, link targets don't; a thread ref is one word. */
export function words(text: string): number {
  return visible(text).split(/\s+/).filter(Boolean).length;
}

/** Path-like tokens outside markdown links (e.g. /x, ~/x, plan.md). */
export function barePaths(text: string): string[] {
  return text
    .replace(MD_LINK, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[("'`<]+|[)"'`>,.;:!?]+$/g, ""))
    .filter((token) => PATH_LIKE.test(token));
}

/** Raw non-thread bb ids in the visible text (thread ids are allowed: they render as chips). */
export function rawIds(text: string): string[] {
  return [...visible(text).matchAll(OTHER_ID)].map((match) => match[0]);
}

/** Thread ids referenced outside markdown link targets. */
export function threadRefs(text: string): string[] {
  return [...new Set(segments(text).flatMap((part) => (part.kind === "thread" ? [part.id] : [])))];
}

export type Segment = { kind: "text"; text: string } | { kind: "thread"; id: string };

/** Splits text into markdown runs and thread refs; links are kept whole. */
export function segments(text: string): Segment[] {
  const parts: Segment[] = [];
  const push = (chunk: string) => {
    if (chunk === "") return;
    const last = parts.at(-1);
    if (last?.kind === "text") last.text += chunk;
    else parts.push({ kind: "text", text: chunk });
  };
  let at = 0;
  for (const link of text.matchAll(MD_LINK)) {
    splitThreads(text.slice(at, link.index), push, parts);
    push(link[0]);
    at = link.index + link[0].length;
  }
  splitThreads(text.slice(at), push, parts);
  return parts;
}

function splitThreads(chunk: string, push: (text: string) => void, parts: Segment[]) {
  let at = 0;
  for (const ref of chunk.matchAll(THREAD_REF)) {
    push(chunk.slice(at, ref.index));
    parts.push({ kind: "thread", id: ref[1] });
    at = ref.index + ref[0].length;
  }
  push(chunk.slice(at));
}

/** The Description column text; legacy reports fall back to result, then summary. */
export function reportDescription(report: { description?: string; result?: string; summary: string }): string {
  return report.description || report.result || report.summary;
}
