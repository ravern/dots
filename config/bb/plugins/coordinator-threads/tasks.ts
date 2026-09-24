// Pure task model: validation, derivation from native child state, the single
// task status, close guards, and the metadata size cap. No SDK calls here, so
// tasks.test.ts can exercise it directly.
import { z } from "zod";
import { barePaths, rawIds, reportDescription, words } from "./text.ts";

export { barePaths, rawIds, reportDescription, segments, threadRefs } from "./text.ts";

export const OUTCOMES = ["done", "blocked", "failed", "cancelled"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Serialized cap for one report; the whole namespace is capped by the SDK at 256 KiB. */
export const REPORT_MAX_BYTES = 8 * 1024;
/** Stay well under the SDK's 256 KiB namespace limit. */
export const METADATA_MAX_BYTES = 192 * 1024;
export const DESCRIPTION_MAX_WORDS = 10;
export const NEEDS_YOU_MAX_WORDS = 15;
export const TITLE_MAX = 80;
export const BRIEF_MAX = 500;

const prose = (max: number) => z.string().trim().max(max).default("");

/** Fields older reports carried; accepted and dropped so existing habits don't fail. */
const DROPPED_FIELDS = ["undo", "verified", "notVerified"] as const;

/** The JSON a coordinator pipes to `report --report-stdin`. */
export const reportInputSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const copy: Record<string, unknown> = { ...raw };
    for (const key of DROPPED_FIELDS) delete copy[key];
    return copy;
  },
  z
  .object({
    outcome: z.enum(OUTCOMES),
    /** Optional concise lowercase task title; renames the task. */
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    /** Legacy name for `description`. */
    result: z.string().trim().min(1).max(300).optional(),
    summary: prose(300),
    needsYou: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .default(null)
      // "none" is what the child report format says when nothing is needed.
      .transform((value) => (value === null || value === "" || /^none\.?$/i.test(value) ? null : value)),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.description !== undefined && input.result !== undefined) {
      ctx.addIssue({ code: "custom", path: ["result"], message: "use description only (result is its legacy name)" });
    }
    const description = input.description ?? input.result;
    const linkHint = 'link files instead, e.g. [plan](/Users/me/plan.md)';
    for (const [field, text] of [["description", description], ["needsYou", input.needsYou]] as const) {
      const paths = text ? barePaths(text) : [];
      if (paths.length > 0) {
        ctx.addIssue({ code: "custom", path: [field], message: `bare file path ${JSON.stringify(paths[0])}; ${linkHint}` });
      }
      if (text?.includes(";")) {
        ctx.addIssue({ code: "custom", path: [field], message: "use one short phrase, no semicolons" });
      }
      const ids = text ? rawIds(text) : [];
      if (ids.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `raw id ${JSON.stringify(ids[0])}; describe it in words, e.g. 'hourly sync automation' (thread ids are fine: they render as chips)`,
        });
      }
    }
    if (description === undefined) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "required: one plain phrase, ≤10 words" });
    } else if (words(description) > DESCRIPTION_MAX_WORDS) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: `${words(description)} words; shorten to ≤${DESCRIPTION_MAX_WORDS} words (leave detail in the child thread)`,
      });
    }
    if (input.needsYou !== null && words(input.needsYou) > NEEDS_YOU_MAX_WORDS) {
      ctx.addIssue({
        code: "custom",
        path: ["needsYou"],
        message: `${words(input.needsYou)} words; shorten to ≤${NEEDS_YOU_MAX_WORDS} words`,
      });
    }
  }),
);

export const reportSchema = z.object({
  outcome: z.enum(OUTCOMES),
  description: z.string().optional(),
  /** Legacy reports stored `result` instead of `description`. */
  result: z.string().optional(),
  summary: z.string().default(""),
  needsYou: z.string().nullable(),
  reportedAt: z.number(),
});
export type Report = z.infer<typeof reportSchema>;

export const taskSchema = z.object({
  id: z.string().min(1),
  /** Coordinator-set title; absent means "show the first child's title". */
  title: z.string().optional(),
  childThreadIds: z.array(z.string()),
  brief: z.string().optional(),
  report: reportSchema.nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().nullable().optional(),
});
export type Task = z.infer<typeof taskSchema>;

/** Parses a report or throws a readable message listing every problem. */
export function parseReport(text: string | undefined, now: number): { report: Report; title: string | null } {
  if (text === undefined || text.trim() === "") {
    throw new Error("no report JSON; pipe one line with --report-stdin");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`report is not valid JSON: ${(cause as Error).message}`);
  }
  const parsed = reportInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`invalid report: ${issues.join("; ")}`);
  }
  const { title, result, description, ...rest } = parsed.data;
  const report: Report = { ...rest, description: description ?? result, reportedAt: now };
  if (Buffer.byteLength(JSON.stringify(report)) > REPORT_MAX_BYTES) {
    throw new Error(`report exceeds ${REPORT_MAX_BYTES} bytes; keep it short and link big artifacts instead`);
  }
  return { report, title: title ?? null };
}

/** Metadata is untrusted: keep valid tasks, drop the rest. */
export function parseStoredTasks(metadata: unknown): Task[] {
  const tasks = (metadata as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((task) => {
    const parsed = taskSchema.safeParse(task);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Native child state, normalized from the list item or get + interactions. */
export interface ChildInfo {
  id: string;
  title: string;
  projectId: string;
  providerId: string;
  parentThreadId: string | null;
  status: "active" | "error" | "idle" | "pending" | "starting" | "stopping";
  displayStatus: string;
  hasPendingInteraction: boolean;
  queuedWork: "none" | "waiting" | "failed";
  /** Background agents/commands/goals/workflows still running. */
  busy: boolean;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Latest `client/turn/requested`, fetched only for reported tasks. */
  lastTurnRequestedAt?: number | null;
  missing?: false;
}
export interface MissingChild {
  id: string;
  missing: true;
}

/** One status per task, in priority order (error/closed only when nothing else applies). */
export type Status =
  | "needs-approval"
  | "needs-you"
  | "running"
  | Outcome
  | "error"
  | "closed"
  | "awaiting-report";

const ATTENTION = new Set<Status>(["needs-approval", "needs-you", "blocked", "failed", "error", "awaiting-report"]);

export interface TaskView extends Task {
  implicit: boolean;
  displayTitle: string;
  children: (ChildInfo | MissingChild)[];
  status: Status;
  /** Description cell: the current report's needsYou alone, else its description. */
  line: { needsYou: boolean; text: string } | null;
  closed: boolean;
  attention: boolean;
  lastUpdatedAt: number;
}

export function implicitTaskId(childId: string): string {
  return `t_${childId.replace(/^thr_/, "")}`;
}

/** Stored tasks plus one implicit task per direct child not linked anywhere. */
export function deriveTasks(stored: Task[], directChildren: ChildInfo[]): { task: Task; implicit: boolean }[] {
  const linked = new Set(stored.flatMap((task) => task.childThreadIds));
  const implicit = directChildren
    .filter((child) => !linked.has(child.id))
    .map((child) => ({
      task: {
        id: implicitTaskId(child.id),
        childThreadIds: [child.id],
        report: null,
        createdAt: child.createdAt,
        updatedAt: child.createdAt,
      },
      implicit: true,
    }));
  return [...stored.map((task) => ({ task, implicit: false })), ...implicit];
}

const RUNNING = new Set(["active", "pending", "starting", "stopping"]);

export function viewTask(task: Task, implicit: boolean, byId: Map<string, ChildInfo>): TaskView {
  const children = task.childThreadIds.map((id): ChildInfo | MissingChild => byId.get(id) ?? { id, missing: true });
  const present = children.filter((child): child is ChildInfo => !child.missing);
  const open = present.filter((child) => child.archivedAt === null);
  const closed = task.childThreadIds.length > 0 ? open.length === 0 : task.closedAt != null;
  const report = task.report ?? null;
  // A child resumed after the report makes the report historical.
  const resumed = report !== null && present.some((child) => (child.lastTurnRequestedAt ?? 0) > report.reportedAt);
  const current = resumed ? null : report;
  const running = open.some((child) => RUNNING.has(child.status) || child.queuedWork === "waiting" || child.busy);
  let status: Status;
  if (open.some((child) => child.hasPendingInteraction)) status = "needs-approval";
  else if (current?.needsYou) status = "needs-you";
  else if (running) status = "running";
  else if (current !== null) status = current.outcome;
  else if (open.some((child) => child.status === "error" || child.queuedWork === "failed")) status = "error";
  else if (closed) status = "closed";
  else status = "awaiting-report";
  // needsYou replaces the description, but only while the report is current.
  const line =
    report === null
      ? null
      : current?.needsYou
        ? { needsYou: true, text: current.needsYou }
        : { needsYou: false, text: reportDescription(report) };
  return {
    ...task,
    implicit,
    displayTitle: task.title || present[0]?.title || task.id,
    children,
    status,
    line,
    closed,
    attention: !closed && ATTENTION.has(status),
    lastUpdatedAt: Math.max(task.updatedAt, ...present.map((child) => child.updatedAt)),
  };
}

/** Needs-attention first, then most recently updated. */
export function sortTasks(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => Number(b.attention) - Number(a.attention) || b.lastUpdatedAt - a.lastUpdatedAt);
}

/**
 * Final check before `--close` archives anything. `descendants` maps a child
 * id to the reasons its own descendants are unfinished. Empty = safe.
 */
export function closeBlockers(view: TaskView, descendants: Map<string, string[]>): string[] {
  const reasons: string[] = [];
  const report = view.report ?? null;
  if (report === null) reasons.push("no report saved");
  else {
    if (report.outcome !== "done" && report.outcome !== "cancelled") reasons.push(`outcome is ${report.outcome}`);
    if (report.needsYou !== null) reasons.push(`needs you: ${report.needsYou}`);
  }
  for (const child of view.children) {
    if (child.missing) {
      reasons.push(`${child.id} not found`);
      continue;
    }
    if (child.archivedAt !== null) continue;
    if (child.hasPendingInteraction) reasons.push(`${child.id} has a pending interaction`);
    if (child.status !== "idle") reasons.push(`${child.id} is ${child.status}`);
    if (child.queuedWork !== "none") reasons.push(`${child.id} has queued work (${child.queuedWork})`);
    if (child.busy) reasons.push(`${child.id} has background work running`);
    reasons.push(...(descendants.get(child.id) ?? []));
  }
  return reasons;
}

/**
 * Keeps the namespace under METADATA_MAX_BYTES by dropping the oldest tasks
 * closed through `--close`; their child threads keep the full history.
 */
// ponytail: prunes whole closed tasks oldest-first; move history to bb.storage if coordinators need unbounded history.
export function capTasks(tasks: Task[]): { tasks: Task[]; pruned: number } {
  const size = (list: Task[]) => Buffer.byteLength(JSON.stringify({ version: 1, tasks: list }));
  let kept = tasks;
  const closedOldestFirst = tasks
    .filter((task) => task.closedAt != null)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let pruned = 0;
  while (size(kept) > METADATA_MAX_BYTES && pruned < closedOldestFirst.length) {
    const drop = closedOldestFirst[pruned++];
    kept = kept.filter((task) => task !== drop);
  }
  if (size(kept) > METADATA_MAX_BYTES) {
    throw new Error(`task metadata would exceed ${METADATA_MAX_BYTES} bytes; close finished tasks or shorten reports`);
  }
  return { tasks: kept, pruned };
}

/** Links a child to exactly one task, removing it from any other. */
export function linkChild(tasks: Task[], taskId: string, childId: string, now: number): Task[] {
  return tasks.map((task) => {
    if (task.id === taskId) {
      return task.childThreadIds.includes(childId)
        ? task
        : { ...task, childThreadIds: [...task.childThreadIds, childId], updatedAt: now };
    }
    return task.childThreadIds.includes(childId)
      ? { ...task, childThreadIds: task.childThreadIds.filter((id) => id !== childId), updatedAt: now }
      : task;
  });
}

// ---- Themes: coordinator threads the user marked with `role: "theme"` ----

/** True when this plugin's metadata on a thread marks it as a theme. */
export function isTheme(metadata: unknown): boolean {
  return (metadata as { role?: unknown } | null)?.role === "theme";
}

/** How long a new-thread "Theme" toggle stays armed without a submission. */
export const ARM_TTL_MS = 10 * 60 * 1000;

/** The parts of a `message.dispatch` context the new-theme decision reads. */
export interface DispatchFacts {
  attempt: "join-turn" | "start-turn";
  origin: string | null;
  initiator: string;
  senderThreadId: string | null;
  queuedCount: number;
  parentThreadId: string | null;
  threadCreatedAt: number;
  /** Data a composer attached with `experimental_submit`, when it was this plugin. */
  submission: unknown;
}

/**
 * Whether a dispatch is the first message of a thread the user just created
 * from the app while the new-thread Theme toggle was on (armed at `armedAt`).
 * A plugin submission carrying `{ theme: true }` also counts.
 */
export function isNewThemeDispatch(facts: DispatchFacts, armedAt: number | null, now: number): boolean {
  if ((facts.submission as { theme?: unknown } | null)?.theme === true) return true;
  if (armedAt === null || now - armedAt > ARM_TTL_MS) return false;
  return (
    facts.attempt === "start-turn" &&
    facts.origin === "app" &&
    facts.initiator === "user" &&
    facts.senderThreadId === null &&
    facts.queuedCount === 0 &&
    facts.parentThreadId === null &&
    facts.threadCreatedAt >= armedAt
  );
}

/** Mention item ids are `<coordinator>~<task>`; the host forbids ":" in them. */
export const mentionId = (coordinatorId: string, taskId: string) => `${coordinatorId}~${taskId}`;
export function parseMentionId(id: string): { coordinatorId: string; taskId: string } | null {
  const [coordinatorId, taskId, ...rest] = id.split("~");
  return coordinatorId && taskId && rest.length === 0 ? { coordinatorId, taskId } : null;
}
