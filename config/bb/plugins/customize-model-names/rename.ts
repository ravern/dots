// Pure label logic, shared by the app bundle, the server, and app.test.ts.

export interface Rename {
  from: string;
  to: string;
}

export interface RenameConfig {
  gptStyle: boolean;
  renames: Rename[];
}

const FULL = /^GPT-(\d+(?:\.\d+)*)(?:-([A-Za-z]+))?$/;
const STRIPPED = /^(\d+(?:\.\d+)*)(?:-([A-Za-z]+))?$/;

/** Parses the stored `renames` setting; drops malformed entries. */
export function parseRenames(raw: string): Rename[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is Rename =>
      typeof r === "object" &&
      r !== null &&
      typeof r.from === "string" &&
      typeof r.to === "string" &&
      r.from.trim() !== "",
  );
}

/**
 * Returns the replacement for a label's text, or null to leave it alone.
 * Custom renames are exact (trimmed) matches and win over the GPT rule.
 * The GPT rule matches "GPT-6-Astra" anywhere, but the picker's stripped
 * "6-Astra" / "5.5" only when `inPicker` — bare numbers are too generic.
 */
export function renameLabel(
  text: string,
  inPicker: boolean,
  config: RenameConfig,
): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const custom = config.renames.find((r) => r.from.trim() === trimmed);
  if (custom !== undefined) {
    return custom.to === trimmed ? null : text.replace(trimmed, custom.to);
  }
  if (!config.gptStyle) return null;
  const match = FULL.exec(trimmed) ?? (inPicker ? STRIPPED.exec(trimmed) : null);
  if (match === null) return null;
  const [, version, variant] = match;
  const renamed = variant ? `GPT-${version} ${variant}` : `GPT-${version}`;
  return renamed === trimmed ? null : text.replace(trimmed, renamed);
}

/** Per-provider "show only" patterns, keyed by provider id. */
export type VisibleModels = Record<string, string[]>;

export interface ModelRef {
  id: string;
  displayName: string;
}

/** Parses the stored `visibleModels` setting; drops malformed entries. */
export function parseVisibleModels(raw: string): VisibleModels {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: VisibleModels = {};
  for (const [provider, patterns] of Object.entries(value)) {
    if (!Array.isArray(patterns)) continue;
    const kept = patterns.filter((p): p is string => typeof p === "string" && p.trim() !== "");
    if (kept.length > 0) out[provider] = kept.map((p) => p.trim());
  }
  return out;
}

/** Case-insensitive exact match; a trailing `*` matches any suffix. */
export function matchesPattern(value: string, pattern: string): boolean {
  const v = value.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  return p.endsWith("*") ? v.startsWith(p.slice(0, -1)) : v === p;
}

/**
 * Names a picker row can be matched by: bb's own label, plus the id and full
 * display name of the model it shows. The Codex picker strips "GPT-" from the
 * label ("6-Astra" for "GPT-6-Astra"), hence the suffix match.
 */
export function rowNames(label: string, models: readonly ModelRef[]): string[] {
  const names = [label];
  for (const m of models) {
    if (m.id === label || m.displayName === label || m.displayName.endsWith(`-${label}`)) {
      names.push(m.id, m.displayName);
    }
  }
  return names;
}

/** No patterns (or an empty list) shows everything. */
export function isVisible(names: readonly string[], patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined || patterns.length === 0) return true;
  return names.some((n) => patterns.some((p) => matchesPattern(n, p)));
}

export interface Config extends RenameConfig {
  visibleModels: VisibleModels;
}

/**
 * The provider a model-picker trigger shows, from its title
 * ("Cursor: Grok 4.7 · High reasoning (Fast mode)"). Longest name first so
 * "Claude Code" wins over a provider named "Claude".
 */
export function providerFromTitle<P extends { displayName: string }>(
  title: string,
  providers: readonly P[],
): P | null {
  const sorted = [...providers].sort((a, b) => b.displayName.length - a.displayName.length);
  return sorted.find((p) => title.startsWith(`${p.displayName}: `)) ?? null;
}
