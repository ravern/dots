// Coordinator Threads backend: a task list stored in the coordinator thread's
// plugin metadata, one status per task derived from child threads + report, the
// `bb coordinator-threads` CLI, the Tasks panel RPC, and Themes: coordinator
// threads marked `role: "theme"` that get standing instructions, a sidebar
// section, and a task mention provider.
import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
  type JsonValue,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BRIEF_MAX,
  TITLE_MAX,
  capTasks,
  closeBlockers,
  isNewThemeDispatch,
  isTheme,
  mentionId,
  parseMentionId,
  deriveTasks,
  linkChild,
  parseReport,
  parseStoredTasks,
  sortTasks,
  threadRefs,
  viewTask,
  type ChildInfo,
  type Report,
  type Task,
  type TaskView,
} from "./tasks";

export type { TaskView } from "./tasks";

export const rpcContract = defineRpcContract({
  /** Open tasks only; closed history stays in metadata (`task list --all`). */
  tasks_list: {
    input: z.object({ threadId: z.string().min(1) }),
    /** threadTitles: labels for threads referenced in descriptions (rendered as chips). */
    output: z.object({ tasks: z.array(z.custom<TaskView>()), threadTitles: z.record(z.string(), z.string()) }),
  },
  /** Every theme with its open tasks, for the sidebar section. */
  themes_list: {
    input: z.object({}),
    output: z.object({
      themes: z.array(z.object({ threadId: z.string(), tasks: z.array(z.custom<TaskView>()) })),
      threadTitles: z.record(z.string(), z.string()),
    }),
  },
  theme_set: {
    input: z.object({ threadId: z.string().min(1), on: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** Inline rename from the sidebar; same rules as `task rename`. */
  task_rename: {
    input: z.object({ coordinatorId: z.string().min(1), taskId: z.string().min(1), title: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** New-thread Theme toggle: while armed, the user's next new root thread becomes a theme. */
  theme_arm: {
    input: z.object({ armed: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
});

/** Realtime channel; payload `{}`. Theme membership changed. */
export const THEMES_CHANGED = "themes-changed";
/** Mention provider id; the composer pill is `task · <title>`. */
export const TASK_MENTION_PROVIDER = "task";

const THEME_INSTRUCTIONS = `You are a theme thread: you look after one ongoing stream of the user's work and coordinate it through child threads. Your open tasks appear under Themes in bb's sidebar, built from your child threads and the reports you record.

- Answer simple questions yourself. Delegate real work (code or file changes, investigations, git, operations) to a child thread: write a short brief in your thread storage, then run \`bb thread spawn --parent-self --title "<concise lowercase title>" --prompt-file <brief>\` (2-5 lowercase words, e.g. "hide more models button"). Reuse a suitable existing child for follow-ups (\`bb thread tell\`).
- Never block. After spawning or steering a child, reply in one line and end your turn. Completion notifications wake you. Do not run \`bb thread wait\` or poll.
- When a child reports, record it with one \`bb coordinator-threads report <child-id> [--close] --report-stdin\` call (fields: outcome, title, description of at most 10 words, needsYou). Follow the coordinator-threads skill for the exact rules.
- Relay approvals: when a child needs a decision, tell the user exactly what and link the child. Never infer approval.
- Close finished tasks with --close only when fully done (done or cancelled, nothing pending). Keep recurring or ongoing work open.
- Keep chat to one line ("Done - <short result>.") unless a blocker or question needs the user.
- Read the theme skill at the start of a new session for the full playbook. User instructions override these defaults.`;

/** Realtime channel; payload `{ coordinatorId }`. */
export const TASKS_CHANGED = "tasks-changed";

const REPORT_HINT =
  "tr '\\n' ' ' <<'JSON' | bb coordinator-threads report <id> --report-stdin\n{\"outcome\":\"done\",\"title\":\"short lowercase title\",\"description\":\"one phrase, ≤10 words\",\"needsYou\":null}\nJSON";

const PAGE = 200;
const DESCENDANT_DEPTH = 5;

type Sdk = BbPluginApi["sdk"];
type ListItem = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];

function fromListItem(item: ListItem): ChildInfo {
  const a = item.activity;
  return {
    id: item.id,
    title: item.title ?? item.titleFallback ?? item.id,
    projectId: item.projectId,
    providerId: item.providerId,
    parentThreadId: item.parentThreadId,
    status: item.status,
    displayStatus: item.runtime.displayStatus,
    hasPendingInteraction: item.hasPendingInteraction,
    queuedWork: item.queuedWork,
    busy: a.activeBackgroundAgentCount + a.activeBackgroundCommandCount + a.activeWorkflowCount > 0,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export default async function plugin(bb: BbPluginApi) {
  const sdk = () => bb.sdk;

  bb.settings.define({
    themesInSidebar: { type: "boolean", label: "Show Themes in sidebar", default: false },
  });

  /** All direct children, active and archived, every page, across projects. */
  async function listChildren(parentThreadId: string): Promise<ChildInfo[]> {
    const byId = new Map<string, ChildInfo>();
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += PAGE) {
        const page = await sdk().threads.list({ parentThreadId, archived, includeHidden: true, limit: PAGE, offset });
        for (const item of page) if (item.deletedAt === null) byId.set(item.id, fromListItem(item));
        if (page.length < PAGE) break;
      }
    }
    return [...byId.values()];
  }

  /** A linked thread that is not a direct child (sibling reference, reparented). */
  async function getChild(threadId: string): Promise<ChildInfo | null> {
    try {
      const t = await sdk().threads.get({ threadId });
      if (t.deletedAt !== null) return null;
      const pending = await sdk().threads.interactions.list({ threadId });
      return {
        id: t.id,
        title: t.title ?? t.titleFallback ?? t.id,
        projectId: t.projectId,
        providerId: t.providerId,
        parentThreadId: t.parentThreadId,
        status: t.status,
        displayStatus: t.runtime.displayStatus,
        hasPendingInteraction: pending.length > 0,
        queuedWork: t.queuedMessageCount > 0 ? "waiting" : "none",
        busy: t.activeBackgroundAgentCount > 0,
        archivedAt: t.archivedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    } catch {
      return null;
    }
  }

  async function lastTurnRequestedAt(threadId: string): Promise<number | null> {
    const rows = await sdk().threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      order: "desc",
      limit: "1",
    });
    return rows[0]?.createdAt ?? null;
  }

  async function readStored(coordinatorId: string): Promise<Task[]> {
    return parseStoredTasks(await sdk().threads.getPluginMetadata({ threadId: coordinatorId }));
  }

  async function writeStored(coordinatorId: string, tasks: Task[]): Promise<number> {
    const capped = capTasks(tasks);
    await sdk().threads.updatePluginMetadata({
      threadId: coordinatorId,
      set: { version: 1, tasks: capped.tasks as unknown as JsonValue },
    });
    bb.realtime.publish(TASKS_CHANGED, { coordinatorId });
    return capped.pruned;
  }

  /** Stored + implicit tasks with native child state. Read-only. */
  async function loadTasks(coordinatorId: string): Promise<{ stored: Task[]; views: TaskView[] }> {
    const [stored, direct] = await Promise.all([readStored(coordinatorId), listChildren(coordinatorId)]);
    const byId = new Map(direct.map((child) => [child.id, child]));
    const derived = deriveTasks(stored, direct);
    const extra = [...new Set(derived.flatMap(({ task }) => task.childThreadIds))].filter((id) => !byId.has(id));
    for (const child of await Promise.all(extra.map(getChild))) if (child !== null) byId.set(child.id, child);
    // Only reported tasks with an open child need the resumed-after-report check.
    await Promise.all(
      derived
        .filter(({ task }) => task.report != null)
        .flatMap(({ task }) => task.childThreadIds)
        .map(async (id) => {
          const child = byId.get(id);
          if (child !== undefined && child.archivedAt === null) child.lastTurnRequestedAt = await lastTurnRequestedAt(id);
        }),
    );
    return { stored, views: sortTasks(derived.map(({ task, implicit }) => viewTask(task, implicit, byId))) };
  }

  // One writer per coordinator: each metadata update replaces the whole task list.
  const locks = new Map<string, Promise<unknown>>();
  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    locks.set(key, next.catch(() => undefined));
    return next;
  }

  // ---- Themes ----
  // Membership lives in each thread's metadata (`role: "theme"`, read by
  // agents.configure). The kv index lists them so the sidebar needn't scan
  // every thread. `themeSection` is the native section theme threads are
  // filed into, so one hiddenGroups entry keeps them out of bb's own list.
  const kv = bb.storage.kv;
  const themeIds = async () => (await kv.get<string[]>("themes")) ?? [];

  async function setTheme(threadId: string, on: boolean): Promise<void> {
    await withLock("themes", async () => {
      const thread = await sdk().threads.get({ threadId });
      const ids = new Set(await themeIds());
      if (on) {
        await sdk().threads.updatePluginMetadata({ threadId, set: { role: "theme" } });
        ids.add(threadId);
        let section = (await kv.get<string>("themeSection")) ?? null;
        if (section === null && thread.sectionId) {
          section = thread.sectionId;
          await kv.set("themeSection", section);
        }
        if (section !== null && thread.sectionId !== section) await sdk().threads.update({ threadId, sectionId: section });
      } else {
        await sdk().threads.updatePluginMetadata({ threadId, remove: ["role"] });
        ids.delete(threadId);
      }
      await kv.set("themes", [...ids]);
    });
    bb.realtime.publish(THEMES_CHANGED, {});
  }

  // ponytail: one in-memory arm for the whole server (single user); lost on reload, which just disarms.
  let armedAt: number | null = null;

  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    try {
      const submission = ctx.experimental_submission?.pluginId === bb.pluginId ? ctx.experimental_submission.data : null;
      const facts = {
        attempt: ctx.attempt,
        origin: typeof ctx.origin === "string" ? ctx.origin : null,
        initiator: ctx.initiator,
        senderThreadId: ctx.senderThreadId,
        queuedCount: ctx.queuedMessages.length,
        parentThreadId: ctx.thread.parentThreadId,
        threadCreatedAt: ctx.thread.createdAt,
        submission,
      };
      if (isNewThemeDispatch(facts, armedAt, Date.now())) {
        armedAt = null;
        await setTheme(ctx.thread.id, true);
      }
    } catch (cause) {
      bb.log.warn(`theme tagging failed: ${(cause as Error).message}`);
    }
    return { action: "proceed" };
  });

  bb.agents.configure((context) =>
    isTheme(context.pluginMetadata)
      ? { tools: [], skills: ["coordinator-threads", "theme"], instructions: THEME_INSTRUCTIONS }
      : { tools: [], skills: [] },
  );

  async function threadTitle(threadId: string): Promise<string> {
    const t = await sdk().threads.get({ threadId });
    return t.title ?? t.titleFallback ?? "theme";
  }

  function mentionContext(view: TaskView, theme: string): string {
    const threads = view.children
      .map((c) => (c.missing ? `${c.id} (missing)` : `${c.title} (${c.id}, ${c.archivedAt === null ? c.status : "archived"})`))
      .join("; ");
    return [
      `Referenced task "${view.displayTitle}" (${view.id}) in theme "${theme}".`,
      `Status: ${view.status.replace("-", " ")}.`,
      view.line ? `${view.line.needsYou ? "Needs you" : "Description"}: ${view.line.text}` : null,
      threads ? `Threads: ${threads}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  bb.ui.registerMentionProvider({
    id: TASK_MENTION_PROVIDER,
    label: "Tasks",
    async search({ query, threadId }) {
      const ids = await themeIds();
      // The current theme's tasks first, then every other theme's.
      const scope = threadId !== null && ids.includes(threadId) ? [threadId, ...ids.filter((id) => id !== threadId)] : ids;
      const q = query.trim().toLowerCase();
      const found = await Promise.all(
        scope.map(async (id) => {
          const [{ views }, title] = await Promise.all([loadTasks(id), threadTitle(id)]);
          return views
            .filter((v) => !v.closed && v.displayTitle.toLowerCase().includes(q))
            .map((v) => ({ id: mentionId(id, v.id), title: v.displayTitle, subtitle: `${v.status.replace("-", " ")} · ${title}`, icon: "ListTodo" }));
        }),
      );
      return found.flat().slice(0, 20);
    },
    async resolve(itemId) {
      const ref = parseMentionId(itemId);
      if (ref === null) throw new Error("unknown task reference");
      const [{ views }, theme] = await Promise.all([loadTasks(ref.coordinatorId), threadTitle(ref.coordinatorId)]);
      const view = views.find((v) => v.id === ref.taskId);
      if (view === undefined) throw new Error("that task no longer exists");
      return { context: mentionContext(view, theme) };
    },
  });

  async function resolveCoordinator(flag: string | undefined, ctx: PluginCliContext): Promise<string> {
    const id = flag ?? ctx.threadId;
    if (id === undefined) {
      throw new PluginCliError("no coordinator: not invoked from a thread", {
        code: "missing_coordinator",
        hint: "Pass --coordinator <thread-id>.",
      });
    }
    try {
      await sdk().threads.get({ threadId: id });
    } catch {
      throw new PluginCliError(`coordinator thread ${id} not found`, { code: "coordinator_not_found" });
    }
    return id;
  }

  function findTask(views: TaskView[], id: string, coordinatorId: string): TaskView {
    const view = views.find((v) => v.id === id) ?? views.find((v) => v.childThreadIds.includes(id));
    if (view === undefined) {
      throw new PluginCliError(`${id} is not a task or linked child of coordinator ${coordinatorId}`, {
        code: "task_not_found",
        hint: "Run `bb coordinator-threads task list` for ids, or pass --coordinator <thread-id> for another coordinator.",
      });
    }
    return view;
  }

  /** Stored list with `view` added when it is still implicit. */
  function materialize(stored: Task[], view: TaskView): Task[] {
    if (!view.implicit) return stored;
    const { implicit, displayTitle, children, status, line, closed, attention, lastUpdatedAt, ...task } = view;
    return [...stored, task];
  }

  async function validateChild(childId: string, coordinatorId: string): Promise<void> {
    if (childId === coordinatorId) {
      throw new PluginCliError("a coordinator cannot be its own task child", { code: "invalid_child" });
    }
    if ((await getChild(childId)) === null) {
      throw new PluginCliError(`thread ${childId} not found`, { code: "child_not_found" });
    }
  }

  /** Reasons a thread's non-archived descendants are unfinished. */
  async function descendantBlockers(threadId: string, depth = 0): Promise<string[]> {
    if (depth >= DESCENDANT_DEPTH) return [];
    const reasons: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await sdk().threads.list({ parentThreadId: threadId, archived: false, includeHidden: true, limit: PAGE, offset });
      for (const item of page) {
        if (item.deletedAt !== null) continue;
        const child = fromListItem(item);
        if (child.hasPendingInteraction) reasons.push(`descendant ${child.id} has a pending interaction`);
        else if (child.status !== "idle" && child.status !== "error") reasons.push(`descendant ${child.id} is ${child.status}`);
        else if (child.queuedWork === "waiting" || child.busy) reasons.push(`descendant ${child.id} has work in flight`);
        reasons.push(...(await descendantBlockers(child.id, depth + 1)));
      }
      if (page.length < PAGE) break;
    }
    return reasons;
  }

  async function renameTask(coordinatorId: string, taskId: string, title: string): Promise<Task> {
    return withLock(coordinatorId, async () => {
      const { stored, views } = await loadTasks(coordinatorId);
      const view = findTask(views, taskId, coordinatorId);
      const now = Date.now();
      const tasks = materialize(stored, view).map((t) => (t.id === view.id ? { ...t, title, updatedAt: now } : t));
      await writeStored(coordinatorId, tasks);
      return tasks.find((t) => t.id === view.id)!;
    });
  }

  function stateText(view: TaskView): string {
    return view.status.replace("-", " ");
  }

  function checkTitle(raw: string): string {
    const title = raw.trim();
    if (title === "" || title.length > TITLE_MAX) {
      throw new PluginCliError(`title must be 1-${TITLE_MAX} characters`, {
        code: "invalid_value",
        hint: 'Use a concise lowercase title, 2-5 words, e.g. "hide more models button".',
      });
    }
    return title;
  }

  type CloseResult = { archived: string[]; failed: { id: string; reason: string }[]; blockedBy: string[] };

  /** Guards, then archive each open child with a fresh recheck. Report is already saved. */
  async function closeTask(coordinatorId: string, taskId: string): Promise<CloseResult> {
    return withLock(coordinatorId, async () => {
      const { stored, views } = await loadTasks(coordinatorId);
      const view = findTask(views, taskId, coordinatorId);
      const descendants = new Map<string, string[]>();
      for (const id of view.childThreadIds) descendants.set(id, await descendantBlockers(id));
      const result: CloseResult = { archived: [], failed: [], blockedBy: closeBlockers(view, descendants) };
      if (result.blockedBy.length > 0) return result;
      for (const child of view.children) {
        if (child.missing || child.archivedAt !== null) continue;
        // Recheck right before archiving: a resume can race the guard above.
        const fresh = await getChild(child.id);
        if (fresh === null || fresh.status !== "idle" || fresh.hasPendingInteraction || fresh.queuedWork !== "none") {
          result.failed.push({ id: child.id, reason: `changed before archive (${fresh?.status ?? "not found"})` });
          continue;
        }
        try {
          await sdk().threads.archive({ threadId: child.id });
          result.archived.push(child.id);
        } catch (cause) {
          result.failed.push({ id: child.id, reason: (cause as Error).message });
        }
      }
      if (result.failed.length === 0) {
        const now = Date.now();
        await writeStored(
          coordinatorId,
          stored.map((task) => (task.id === view.id ? { ...task, closedAt: now, updatedAt: now } : task)),
        );
      } else {
        bb.realtime.publish(TASKS_CHANGED, { coordinatorId });
      }
      return result;
    });
  }

  const notFound = (id: string) => (cause: unknown) => {
    throw new PluginCliError(`thread ${id} not found or not updatable: ${(cause as Error).message}`, { code: "thread_not_found" });
  };

  const coordinatorOption = {
    type: "string",
    description: "Coordinator thread id (defaults to the invoking thread)",
    placeholder: "thread-id",
  } as const;
  const jsonOption = { type: "boolean", description: "Emit machine-readable JSON" } as const;

  bb.cli.register(
    defineCli({
      name: "coordinator-threads",
      summary: "Coordinator task list: save child reports, group child threads into tasks",
      description:
        "Tasks live in the coordinator thread's metadata. Every direct child not linked to a task shows as its own implicit task. Runtime state comes from the child threads; the outcome comes from your report.",
      commands: {
        report: cliCommand({
          summary: "Save or replace a task's report (JSON via --report-stdin); --close archives its children when fully done",
          description:
            `Pipe the JSON as one line (tr flattens a quoted heredoc losslessly):\n  ${REPORT_HINT.replaceAll("\n", "\n  ")}\n` +
            'Fields: {"outcome":"done|blocked|failed|cancelled","title":"concise lowercase title","description":"one plain phrase ≤10 words","needsYou":null}. description is required (≤10 words; `result` is its legacy name); needsYou ≤15 words and, when set, replaces the description in the panel; no bare file paths in either (use markdown links, e.g. [plan](/path/plan.md)); title (optional, ≤80 chars) renames the task; undo/verified/notVerified are no longer used and are ignored. A child thread id resolves to its task.',
          positionals: [{ name: "id", description: "Task id or linked child thread id", required: true }],
          options: {
            close: {
              type: "boolean",
              description:
                "After saving, archive the task's children only if outcome is done/cancelled, needsYou is null, and no child or descendant is running, queued, or awaiting approval",
            },
            report: {
              type: "string",
              stdin: true,
              placeholder: "json",
              description: "Report JSON; use --report-stdin with one piped line (flatten a heredoc with tr '\\n' ' ')",
            },
            coordinator: coordinatorOption,
            // Newer bb CLIs forward multiline `--stdin` as `--input-text`; 0.43.4 passes `--stdin` through unread.
            stdin: { type: "boolean", description: "Read report JSON from stdin (bb CLIs that forward it)", hidden: true },
            "input-text": { type: "string", description: "Report JSON forwarded by --stdin", hidden: true },
            json: jsonOption,
          },
          constraints: [{ kind: "at-most-one", options: ["report", "input-text"] }],
          async run(input, ctx) {
            const coordinatorId = await resolveCoordinator(input.options.coordinator, ctx);
            const text = input.options.report ?? input.options["input-text"];
            if (text === undefined && input.options.stdin) {
              throw new PluginCliError("this bb CLI does not forward --stdin to plugin commands", {
                code: "stdin_unsupported",
                hint: REPORT_HINT,
              });
            }
            let report: Report;
            let title: string | null;
            try {
              ({ report, title } = parseReport(text, Date.now()));
            } catch (cause) {
              throw new PluginCliError((cause as Error).message, { code: "invalid_report", hint: REPORT_HINT });
            }
            const saved = await withLock(coordinatorId, async () => {
              const { stored, views } = await loadTasks(coordinatorId);
              const view = findTask(views, input.positionals.id, coordinatorId);
              const now = Date.now();
              const tasks = materialize(stored, view).map((task) =>
                task.id === view.id ? { ...task, ...(title ? { title } : {}), report, updatedAt: now } : task,
              );
              return { taskId: view.id, title: title ?? view.displayTitle, pruned: await writeStored(coordinatorId, tasks) };
            });
            const lines = [`Saved report for ${saved.taskId} "${saved.title}" (${report.outcome}).`];
            if (saved.pruned > 0) lines.push(`Pruned ${saved.pruned} oldest closed task(s) to stay under the metadata cap.`);
            let exitCode = 0;
            let close: CloseResult | null = null;
            if (input.options.close) {
              close = await closeTask(coordinatorId, saved.taskId);
              if (close.blockedBy.length > 0) {
                exitCode = 1;
                lines.push(`Not archived: ${close.blockedBy.join("; ")}.`);
              } else if (close.failed.length > 0) {
                exitCode = 1;
                if (close.archived.length > 0) lines.push(`Archived: ${close.archived.join(", ")}.`);
                lines.push(
                  `Partial: failed to archive ${close.failed.map((f) => `${f.id} (${f.reason})`).join(", ")}. The report is saved; retrying is safe.`,
                );
              } else {
                lines.push(`Archived: ${close.archived.join(", ") || "nothing open"}. Task closed.`);
              }
            }
            if (input.options.json) {
              const receipt = { taskId: saved.taskId, reportSaved: true, outcome: report.outcome, prunedClosedTasks: saved.pruned, close };
              return { exitCode, stdout: JSON.stringify(receipt) };
            }
            return exitCode === 0 ? { exitCode, stdout: lines.join("\n") } : { exitCode, stderr: lines.join("\n") };
          },
        }),
        "task new": cliCommand({
          summary: "Create a task, optionally linking child threads (moved from any other task)",
          options: {
            title: { type: "string", required: true, description: `Concise lowercase task title, 2-5 words (≤${TITLE_MAX} chars)` },
            child: { type: "string", repeatable: true, description: "Thread id to link; repeatable", placeholder: "thread-id" },
            brief: { type: "string", description: `Short brief or brief-file path (≤${BRIEF_MAX} chars)` },
            coordinator: coordinatorOption,
            json: jsonOption,
          },
          async run(input, ctx) {
            const coordinatorId = await resolveCoordinator(input.options.coordinator, ctx);
            const title = checkTitle(input.options.title);
            const brief = input.options.brief?.trim();
            if (brief !== undefined && brief.length > BRIEF_MAX) {
              throw new PluginCliError(`brief must be ≤${BRIEF_MAX} characters; link a file instead`, { code: "invalid_value" });
            }
            for (const id of input.options.child) await validateChild(id, coordinatorId);
            const task = await withLock(coordinatorId, async () => {
              const now = Date.now();
              const created: Task = {
                id: `t_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
                title,
                childThreadIds: [],
                ...(brief ? { brief } : {}),
                report: null,
                createdAt: now,
                updatedAt: now,
              };
              let tasks = [...(await readStored(coordinatorId)), created];
              for (const id of input.options.child) tasks = linkChild(tasks, created.id, id, now);
              await writeStored(coordinatorId, tasks);
              return tasks.find((t) => t.id === created.id)!;
            });
            const children = task.childThreadIds.length ? ` with ${task.childThreadIds.join(", ")}` : "";
            return { exitCode: 0, stdout: input.options.json ? JSON.stringify(task) : `Created ${task.id} "${task.title}"${children}.` };
          },
        }),
        "task link": cliCommand({
          summary: "Attach a child thread to an existing task (moving it from any other task)",
          positionals: [
            { name: "task-id", description: "Task id (or a child id already in the task)", required: true },
            { name: "child-id", description: "Thread id to attach; may be a sibling coordinator's child", required: true },
          ],
          options: { coordinator: coordinatorOption, json: jsonOption },
          async run(input, ctx) {
            const coordinatorId = await resolveCoordinator(input.options.coordinator, ctx);
            const childId = input.positionals["child-id"];
            await validateChild(childId, coordinatorId);
            const task = await withLock(coordinatorId, async () => {
              const { stored, views } = await loadTasks(coordinatorId);
              const view = findTask(views, input.positionals["task-id"], coordinatorId);
              const tasks = linkChild(materialize(stored, view), view.id, childId, Date.now());
              await writeStored(coordinatorId, tasks);
              return tasks.find((t) => t.id === view.id)!;
            });
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(task)
                : `Linked ${childId} to ${task.id}${task.title ? ` "${task.title}"` : ""} (children: ${task.childThreadIds.join(", ")}).`,
            };
          },
        }),
        "task rename": cliCommand({
          summary: "Set a task's title (concise lowercase, 2-5 words); defaults to its first child's title",
          positionals: [
            { name: "task-id", description: "Task id (or a child id in the task)", required: true },
            { name: "title", description: `New title (≤${TITLE_MAX} chars)`, required: true },
          ],
          options: { coordinator: coordinatorOption, json: jsonOption },
          async run(input, ctx) {
            const coordinatorId = await resolveCoordinator(input.options.coordinator, ctx);
            const title = checkTitle(input.positionals.title);
            const task = await renameTask(coordinatorId, input.positionals["task-id"], title);
            return { exitCode: 0, stdout: input.options.json ? JSON.stringify(task) : `Renamed ${task.id} to "${title}".` };
          },
        }),
        "theme add": cliCommand({
          summary: "Mark a thread as a theme (standing instructions, Themes sidebar, filed into the themes section)",
          positionals: [{ name: "thread-id", description: "Thread to mark", required: true }],
          options: { json: jsonOption },
          async run(input) {
            const id = input.positionals["thread-id"];
            await setTheme(id, true).catch(notFound(id));
            return { exitCode: 0, stdout: input.options.json ? JSON.stringify({ threadId: id, theme: true }) : `Marked ${id} as a theme. New sessions get the theme instructions.` };
          },
        }),
        "theme remove": cliCommand({
          summary: "Stop treating a thread as a theme (keeps its tasks and section)",
          positionals: [{ name: "thread-id", description: "Thread to unmark", required: true }],
          options: { json: jsonOption },
          async run(input) {
            const id = input.positionals["thread-id"];
            await setTheme(id, false).catch(notFound(id));
            return { exitCode: 0, stdout: input.options.json ? JSON.stringify({ threadId: id, theme: false }) : `${id} is no longer a theme.` };
          },
        }),
        "theme list": cliCommand({
          summary: "List theme threads",
          options: { json: jsonOption },
          async run(input) {
            const ids = await themeIds();
            const rows = await Promise.all(ids.map(async (id) => ({ id, title: await threadTitle(id).catch(() => "(missing)") })));
            if (input.options.json) return { exitCode: 0, stdout: JSON.stringify({ themes: rows, section: (await kv.get<string>("themeSection")) ?? null }) };
            return { exitCode: 0, stdout: rows.length ? rows.map((r) => `${r.id}  ${r.title}`).join("\n") : "No themes." };
          },
        }),
        "task list": cliCommand({
          summary: "List tasks: needs-attention (!) first, then recently updated",
          options: {
            all: { type: "boolean", description: "Include closed tasks (history)", aliases: ["history"] },
            coordinator: coordinatorOption,
            json: jsonOption,
          },
          async run(input, ctx) {
            const coordinatorId = await resolveCoordinator(input.options.coordinator, ctx);
            const { views } = await loadTasks(coordinatorId);
            // ponytail: capped at 200 rows to stay under the CLI output limit; add paging if a coordinator outgrows it.
            const shown = views.filter((v) => input.options.all || !v.closed).slice(0, 200);
            if (input.options.json) {
              const rows = shown.map(({ children, ...v }) => ({
                ...v,
                children: children.map((c) =>
                  c.missing ? c : { id: c.id, title: c.title, status: c.status, archived: c.archivedAt !== null },
                ),
              }));
              return { exitCode: 0, stdout: JSON.stringify(rows) };
            }
            if (shown.length === 0) return { exitCode: 0, stdout: "No tasks." };
            const lines = shown.map((v) => {
              const needs = v.report?.needsYou ? `  needs you: ${v.report.needsYou}` : "";
              return `${v.attention ? "!" : " "} ${v.id}  ${v.displayTitle}  [${stateText(v)}]  children: ${v.childThreadIds.join(", ") || "—"}${needs}`;
            });
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
      },
    }),
  );

  async function titlesFor(tasks: TaskView[]): Promise<Record<string, string>> {
    const refs = [...new Set(tasks.flatMap((v) => (v.line ? threadRefs(v.line.text) : [])))];
    const resolved = refs.length === 0 ? [] : await sdk().threads.resolveMentions({ threadIds: refs }).catch(() => []);
    return Object.fromEntries(resolved.map((m) => [m.threadId, m.label]));
  }

  bb.rpc.register(rpcContract, {
    tasks_list: async ({ threadId }) => {
      const { views } = await loadTasks(threadId);
      const tasks = views.filter((v) => !v.closed);
      return { tasks, threadTitles: await titlesFor(tasks) };
    },
    themes_list: async () => {
      const themes = await Promise.all(
        (await themeIds()).map(async (threadId) => {
          const loaded = await loadTasks(threadId).catch(() => null);
          return { threadId, tasks: loaded ? loaded.views.filter((v) => !v.closed) : [] };
        }),
      );
      return { themes, threadTitles: await titlesFor(themes.flatMap((t) => t.tasks)) };
    },
    theme_set: async ({ threadId, on }) => {
      await setTheme(threadId, on);
      return { ok: true as const };
    },
    task_rename: async ({ coordinatorId, taskId, title }) => {
      await renameTask(coordinatorId, taskId, checkTitle(title));
      return { ok: true as const };
    },
    theme_arm: async ({ armed }) => {
      armedAt = armed ? Date.now() : null;
      return { ok: true as const };
    },
  });
}
