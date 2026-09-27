// bb labels a provider's service-tier toggle "<label> mode" and the model picker's summary
// " (Fast mode)" for every provider. Devin Cloud declares the tier label "Priority", so its
// toggle reads "Priority mode" — the only provider whose does. Show both as plain "Priority".
const TOGGLE = "Priority mode";
const SUMMARY_TAIL = " (Fast mode)";

/** Devin Cloud's tier text as "Priority"; any other text (other providers' Fast mode) unchanged. */
export function relabel(text: string): string {
  if (text === TOGGLE) return "Priority";
  if (text.startsWith("Devin Cloud: ") && text.endsWith(SUMMARY_TAIL)) return `${text.slice(0, -SUMMARY_TAIL.length)} (Priority)`;
  return text;
}

/**
 * The Devin Cloud model a model-picker trigger's title names, else null:
 * "Devin Cloud: SWE-2 · High reasoning (Priority)" → "SWE-2".
 */
export function devinModelFromTitle(title: string): string | null {
  return /^Devin Cloud: (.+?)(?: · .+ reasoning)?(?: \((?:Fast mode|Priority)\))?$/.exec(title)?.[1] ?? null;
}

/** Whether a picker's model label names one of the priority models; bb may recase it ("Swe-2"). */
export function hasPriority(label: string | null, priority: readonly string[]): boolean {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return label !== null && priority.some((name) => key(name) === key(label));
}
