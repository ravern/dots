// Coordinator Threads frontend: the "View tasks" thread-panel action (opens a
// "Tasks" tab). One row per open task with a single status derived in tasks.ts
// from child threads + the coordinator's report. Refetches on mount,
// reconnect, plugin writes, and relevant native thread changes.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Markdown,
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { TaskView, rpcContract } from "./server";
import type { ChildInfo, Status } from "./tasks";
import { reportDescription, segments } from "./text";
import { cn } from "@/lib/utils";
import { SidebarNavigation, TaskInserter, ThemeBanner, ThemeToggle } from "./themes";

const TASKS_CHANGED = "tasks-changed";
// Native changes that never affect a task row.
const IGNORED_CHANGES = new Set([
  "events-appended",
  "read-state-changed",
  "tabs-changed",
  "terminals-changed",
  "order-changed",
  "pin-state-changed",
]);

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const when = (ms: number) => new Date(ms).toLocaleString();

function useTasks(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [threadTitles, setThreadTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Set<string>());

  const refetch = useCallback(() => {
    rpc.call("tasks_list", { threadId }).then(
      (result) => {
        known.current = new Set([threadId, ...result.tasks.flatMap((task) => task.childThreadIds)]);
        setTasks(result.tasks);
        setThreadTitles(result.threadTitles);
        setError(null);
      },
      (cause) => setError(errorText(cause)),
    );
  }, [rpc, threadId]);

  useEffect(refetch, [refetch]);

  useRealtime(TASKS_CHANGED, (payload) => {
    if ((payload as { coordinatorId?: unknown } | null)?.coordinatorId === threadId) refetch();
  });

  // Native thread changes: children appearing, status, approvals, archive.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      callback: (event) => {
        const changes = event.changes.filter((change) => !IGNORED_CHANGES.has(change));
        if (changes.length === 0) return;
        const structural = changes.includes("thread-created") || changes.includes("parent-changed");
        if (!structural && (event.id === undefined || !known.current.has(event.id))) return;
        clearTimeout(timer);
        timer = setTimeout(refetch, 400);
      },
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [sdk, refetch]);

  // Ephemeral signals can be missed while disconnected.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current !== "connected" && connection === "connected") refetch();
    previous.current = connection;
  }, [connection, refetch]);

  return { tasks, threadTitles, error };
}

const ATTENTION_TONE = "border-amber-500/50 text-amber-600 dark:text-amber-400";
const MUTED_TONE = "border-border text-muted-foreground";
const STATUS: Record<Status, { label: string; tone: string }> = {
  "needs-approval": { label: "Needs approval", tone: ATTENTION_TONE },
  "needs-you": { label: "Needs you", tone: ATTENTION_TONE },
  running: { label: "Running", tone: "border-sky-500/50 text-sky-600 dark:text-sky-400" },
  done: { label: "Done", tone: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" },
  blocked: { label: "Blocked", tone: "border-orange-500/50 text-orange-600 dark:text-orange-400" },
  failed: { label: "Failed", tone: "border-destructive/50 text-destructive" },
  error: { label: "Error", tone: "border-destructive/50 text-destructive" },
  cancelled: { label: "Cancelled", tone: MUTED_TONE },
  closed: { label: "Closed", tone: MUTED_TONE },
  "awaiting-report": { label: "Awaiting report", tone: MUTED_TONE },
};

function StatusCell({ task }: { task: TaskView }) {
  const { label, tone } = STATUS[task.status];
  return (
    <span className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-px text-[11px] leading-4", tone)}>{label}</span>
  );
}

function dot(child: ChildInfo): { tone: string; label: string } {
  if (child.archivedAt !== null) return { tone: "border border-muted-foreground/60", label: "archived" };
  if (child.hasPendingInteraction) return { tone: "bg-amber-500", label: "pending approval" };
  if (child.status === "error" || child.queuedWork === "failed") return { tone: "bg-destructive", label: "error" };
  if (child.status !== "idle" || child.queuedWork === "waiting" || child.busy) return { tone: "bg-sky-500", label: child.displayStatus };
  return { tone: "bg-muted-foreground/50", label: "idle" };
}

function ThreadChips({ task }: { task: TaskView }) {
  const navigate = useBbNavigate();
  return (
    <div className="flex flex-wrap gap-1">
      {task.children.map((child) => {
        if (child.missing) {
          return (
            <span key={child.id} className="text-[11px] text-muted-foreground" title={`${child.id} not found`}>
              missing
            </span>
          );
        }
        const state = dot(child);
        return (
          <button
            key={child.id}
            type="button"
            title={`${child.title}\n${child.id} · ${state.label}`}
            aria-label={`Open thread ${child.title} (${state.label})`}
            onClick={() => navigate.toThread(child.id)}
            className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] leading-4 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", state.tone)} />
            <span className="truncate">{child.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function descriptionTooltip(task: TaskView, threadTitles: Record<string, string>): string | undefined {
  const report = task.report ?? null;
  if (report === null) return undefined;
  // Thread refs read as their titles in the plain-text tooltip.
  const plain = (text: string) =>
    segments(text)
      .map((part) => (part.kind === "text" ? part.text : (threadTitles[part.id] ?? part.id)))
      .join("");
  return [
    report.needsYou ? `Needs you: ${report.needsYou}` : null,
    reportDescription(report),
    `Reported ${when(report.reportedAt)}`,
  ]
    .filter((line): line is string => Boolean(line))
    .map(plain)
    .join("\n\n");
}

// Text runs use bb's chat Markdown renderer (links, including local files, open
// like chat links); thread refs become chips, since that renderer leaves
// `@thread:` mentions as text. Runs are inlined so line-clamp works.
function DescriptionCell({ task, threadTitles }: { task: TaskView; threadTitles: Record<string, string> }) {
  const navigate = useBbNavigate();
  if (task.line === null || task.line.text === "") return <span className="text-muted-foreground">—</span>;
  const content = task.line.needsYou ? `Needs you: ${task.line.text}` : task.line.text;
  return (
    <div
      className={cn(
        "line-clamp-2 break-words text-sm [&_[data-markdown-preview]]:inline [&_p]:m-0 [&_p]:inline",
        // Markdown sets its own text colour; force the attention colour through it (not the chips).
        task.line.needsYou &&
          "text-amber-600 dark:text-amber-400 [&_[data-markdown-preview]]:!text-inherit [&_[data-markdown-preview]_*]:!text-inherit",
      )}
    >
      {segments(content).map((part, index) =>
        part.kind === "text" ? (
          <Markdown key={index} content={part.text} />
        ) : (
          <button
            key={index}
            type="button"
            title={part.id}
            onClick={() => navigate.toThread(part.id)}
            className="mx-0.5 inline rounded border border-border bg-muted/40 px-1 py-px align-baseline text-[12px] leading-4 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {threadTitles[part.id] ?? "thread"}
          </button>
        ),
      )}
    </div>
  );
}

function TasksPanel({ threadId }: PluginThreadPanelProps) {
  const { tasks, threadTitles, error } = useTasks(threadId);
  return (
    <div className="text-sm">
      {error !== null ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          Could not load tasks: {error}
        </p>
      ) : null}
      {tasks === null ? (
        error === null ? (
          <p role="status" className="text-muted-foreground">
            Loading tasks…
          </p>
        ) : null
      ) : tasks.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-muted-foreground">
          No open tasks. Child threads of this thread appear here automatically.
        </p>
      ) : (
        // Separate borders so a highlighted row's cells can carry a rounded inset band;
        // every cell gets px-3 so text never touches the tint and columns stay aligned.
        <table className="w-full table-fixed border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-xs text-muted-foreground [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
              <th className="w-[18%]">Task</th>
              {/* Just wide enough for "Needs approval" plus padding; the rest goes to Description. */}
              <th className="w-[8rem] whitespace-nowrap">Status</th>
              <th>Description</th>
              <th className="w-[14%]">Threads</th>
              <th className="w-[5rem]">Updated</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className={cn(
                  "align-top [&>td]:border-b [&>td]:border-border [&>td]:px-3 [&>td]:py-2",
                  task.attention &&
                    "[&>td]:border-transparent [&>td]:bg-amber-500/5 [&>td:first-child]:rounded-l-[8px] [&>td:last-child]:rounded-r-[8px]",
                )}
              >
                <td title={[task.id, task.brief].filter(Boolean).join("\n")}>
                  <span className="break-words">
                    {task.attention ? <span className="sr-only">Needs attention: </span> : null}
                    {task.displayTitle}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  <StatusCell task={task} />
                </td>
                <td title={descriptionTooltip(task, threadTitles)}>
                  <DescriptionCell task={task} threadTitles={threadTitles} />
                </td>
                <td>
                  <ThreadChips task={task} />
                </td>
                <td className="text-xs text-muted-foreground" title={when(task.lastUpdatedAt)}>
                  {ago(task.lastUpdatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  // Themes: bb's own nav items, then the Themes section (behind the "Show Themes in sidebar" setting).
  app.slots.experimental_sidebarNavigation({
    id: "themes",
    title: "Themes",
    description: "bb's navigation plus a Themes section: theme threads, their tasks and threads",
    component: SidebarNavigation,
  });
  app.composer.customize({
    id: "theme-toggle",
    scopes: ["new-thread"],
    actions: [{ id: "theme-toggle", component: ThemeToggle }],
    banners: [{ id: "theme-banner", chrome: "bare", component: ThemeBanner }],
  });
  app.composer.customize({ id: "task-inserter", scopes: ["thread"], actions: [{ id: "task-inserter", component: TaskInserter }] });

  app.slots.threadPanelAction({
    id: "tasks",
    title: "View tasks",
    icon: "ListTodo",
    component: TasksPanel,
    // The launcher reads "View tasks"; the opened tab keeps the short title.
    run: ({ openPanel }) => {
      openPanel({ title: "Tasks" });
    },
  });
});
