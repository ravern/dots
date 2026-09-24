// Themes sidebar section: theme threads (coordinators marked `role: "theme"`)
// → their open tasks → each task's threads. Rendered under bb's own nav items
// through experimental_sidebarNavigation; bb's thread list stays below it.
// Also the composer pieces: the new-thread "Theme" toggle + banner, and the
// hidden inserter that puts "Add to chat" task chips into a theme's composer.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import * as HoverCard from "@radix-ui/react-hover-card";
import {
  Markdown,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
  useSettings,
  type ExperimentalSidebarNavigationProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { TaskView, rpcContract } from "./server";
import type { ChildInfo, Status } from "./tasks";
import { segments } from "./text";
import { CLOSE_DELAY_MS, hover, idle, inTriangle } from "./hover";
import { cn } from "@/lib/utils";

const TASKS_CHANGED = "tasks-changed";
const THEMES_CHANGED = "themes-changed";
const MENTION_PROVIDER = "task";
/** The plugin's CSS is scoped to this attribute; portaled overlays need it too. */
const SCOPE = { "data-bb-plugin": "coordinator-threads" } as const;
const IGNORED_CHANGES = new Set(["events-appended", "read-state-changed", "tabs-changed", "terminals-changed", "order-changed", "pin-state-changed"]);
/** bb's list keeps at least this much height (~4 rows) plus divider and footer below the section. */
const LIST_RESERVE_PX = 130 + 17 + 56;

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
const CompactContext = createContext(false);

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------------------------------------------------------------- small stores
// Module state shared by the sidebar and composer slots (one app bundle per client).
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
const toggleStore = store(false);
type InsertRequest = { threadId: string; mention: { provider: string; id: string; label: string }; quote: string; at: number };
const insertStore = store<InsertRequest | null>(null);
const useStore = <T,>(s: ReturnType<typeof store<T>>) => useSyncExternalStore(s.subscribe, s.get);

function armTheme(rpc: Rpc, armed: boolean) {
  toggleStore.set(armed);
  rpc.call("theme_arm", { armed }).catch(() => undefined);
}

// ---------------------------------------------------------------- glyphs
const svg = (children: ReactNode, className?: string, size = 14) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", className)}>
    {children}
  </svg>
);
const ATTN_TEXT = "text-amber-600 dark:text-amber-400";
const Glyph = {
  attn: (s?: number) => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></>, ATTN_TEXT, s),
  run: (s?: number) => svg(<path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5 6.8 15M17.2 9l2.6-1.5" />, "text-primary animate-[spin_1.6s_linear_infinite] motion-reduce:animate-none", s),
  done: (s?: number) => svg(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>, "text-[var(--success,#40c977)]", s),
  block: (s?: number) => svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>, "text-[var(--warning,#ff8549)]", s),
  fail: (s?: number) => svg(<><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>, "text-destructive", s),
  wait: (s?: number) => svg(<circle cx="12" cy="12" r="9" strokeDasharray="3 3.2" />, "text-muted-foreground", s),
};
const STATUS: Record<Status, { glyph: keyof typeof Glyph; label: string }> = {
  "needs-approval": { glyph: "attn", label: "Needs approval" },
  "needs-you": { glyph: "attn", label: "Needs you" },
  running: { glyph: "run", label: "Running" },
  done: { glyph: "done", label: "Done" },
  blocked: { glyph: "block", label: "Blocked" },
  failed: { glyph: "fail", label: "Failed" },
  error: { glyph: "fail", label: "Error" },
  cancelled: { glyph: "wait", label: "Cancelled" },
  closed: { glyph: "wait", label: "Closed" },
  "awaiting-report": { glyph: "wait", label: "Awaiting report" },
};
const PILL: Record<keyof typeof Glyph, string> = {
  attn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  run: "bg-primary/12 text-primary",
  done: "bg-[color-mix(in_oklab,var(--success,#40c977)_13%,transparent)] text-[var(--success,#40c977)]",
  block: "bg-[color-mix(in_oklab,var(--warning,#ff8549)_13%,transparent)] text-[var(--warning,#ff8549)]",
  fail: "bg-destructive/12 text-destructive",
  wait: "bg-sidebar-accent text-muted-foreground",
};
const Chevron = ({ open }: { open: boolean }) =>
  svg(<path d="m9 6 6 6-6 6" />, cn("text-muted-foreground transition-transform duration-150", open && "rotate-90"), 12);
const LayersIcon = (s = 14) => svg(<><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="m3 13 9 5 9-5" /></>, undefined, s);

function childDot(child: ChildInfo): string {
  if (child.archivedAt !== null) return "border border-muted-foreground/60";
  if (child.hasPendingInteraction) return "bg-amber-500";
  if (child.status === "error" || child.queuedWork === "failed") return "bg-destructive";
  if (child.status !== "idle" || child.queuedWork === "waiting" || child.busy) return "bg-primary";
  return "bg-muted-foreground/45";
}

// ---------------------------------------------------------------- data
type ThemeData = { threadId: string; tasks: TaskView[] };

function useThemes() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [themes, setThemes] = useState<ThemeData[] | null>(null);
  const [threadTitles, setThreadTitles] = useState<Record<string, string>>({});
  const known = useRef(new Set<string>());
  const refetch = useCallback(() => {
    rpc.call("themes_list", {}).then(
      (result) => {
        known.current = new Set(result.themes.flatMap((t) => [t.threadId, ...t.tasks.flatMap((task) => task.childThreadIds)]));
        setThemes(result.themes);
        setThreadTitles(result.threadTitles);
      },
      () => setThemes((prev) => prev ?? []),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime(TASKS_CHANGED, refetch);
  useRealtime(THEMES_CHANGED, refetch);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      callback: (event) => {
        const changes = event.changes.filter((c) => !IGNORED_CHANGES.has(c));
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
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current !== "connected" && connection === "connected") refetch();
    previous.current = connection;
  }, [connection, refetch]);
  return { themes, threadTitles };
}

/** Expanded themes/tasks and the section's collapsed state, per client. */
function useExpanded() {
  const KEY = "coordinator-threads:themes-expanded";
  const [state, setState] = useState<{ open: string[]; collapsed: boolean }>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (parsed && Array.isArray(parsed.open)) return { open: parsed.open.filter((x: unknown) => typeof x === "string"), collapsed: parsed.collapsed === true };
    } catch {}
    return { open: [], collapsed: false };
  });
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(state)), [state]);
  const isOpen = (id: string) => state.open.includes(id);
  const toggle = (id: string) => setState((s) => ({ ...s, open: s.open.includes(id) ? s.open.filter((x) => x !== id) : [...s.open, id] }));
  const toggleSection = () => setState((s) => ({ ...s, collapsed: !s.collapsed }));
  return { isOpen, toggle, collapsed: state.collapsed, toggleSection };
}

// ---------------------------------------------------------------- sidebar slot
export function SidebarNavigation(props: ExperimentalSidebarNavigationProps) {
  const Original = props.experimental_Original;
  const { values } = useSettings();
  return (
    <>
      <Original />
      {values?.themesInSidebar === true ? <ThemesSection compact={props.isCompactViewport} /> : null}
    </>
  );
}

const rowBase = "group/row relative flex w-full min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-[10px] px-2 text-left text-sidebar-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring";
/** Same classes as bb's own thread rows: the selected row keeps bb's selected token and ignores hover. */
const rowState = (selected: boolean) =>
  selected ? "bg-state-active bb-sidebar-selected-row" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

/** Inline title editor, styled like bb's row rename: Enter or blur saves, Escape cancels, empty is rejected. */
function InlineRename({ initial, label, onDone }: { initial: string; label: string; onDone: (value: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    const next = value.trim();
    if (save && next === "") return setInvalid(true);
    done.current = true;
    onDone(save && next !== initial ? next : null);
  };
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      ref={ref}
      aria-label={label}
      aria-invalid={invalid}
      value={value}
      maxLength={80}
      onChange={(e) => {
        setValue(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(value.trim() !== "")}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onPointerEnter={stop}
      className={cn("min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 [font:inherit] text-inherit outline-none", invalid && "rounded-sm ring-1 ring-destructive")}
    />
  );
}

function ThemesSection({ compact }: { compact: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const { themes, threadTitles } = useThemes();
  const { threads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const { threadId: activeThreadId } = useBbContext();
  const expanded = useExpanded();
  const body = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [sheetTask, setSheetTask] = useState<{ theme: string; task: TaskView } | null>(null);
  const [card, dispatch] = useReducer(hover, idle);
  /** `theme:<id>` or `task:<theme>/<task>` while its title is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const openKey = useRef<string | null>(null);
  openKey.current = card.key;
  const exitPoint = useRef<{ x: number; y: number } | null>(null);
  const pendingSwitch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardEvents = (key: string) => ({
    enter: (e?: React.PointerEvent) => {
      clearTimeout(pendingSwitch.current);
      const rect = document.querySelector("[data-theme-card]")?.getBoundingClientRect();
      const heading =
        e !== undefined && openKey.current !== null && openKey.current !== key && exitPoint.current !== null && rect !== undefined &&
        inTriangle({ x: e.clientX, y: e.clientY }, exitPoint.current, { x: rect.left, y: rect.top - 4 }, { x: rect.left, y: rect.bottom + 4 });
      if (!heading) return dispatch({ type: "enter-row", key });
      // Passing over this row on the way to the open card: hold the card, switch only if the pointer rests here.
      dispatch({ type: "enter-card" });
      pendingSwitch.current = setTimeout(() => dispatch({ type: "enter-row", key }), 200);
    },
    leave: (e?: React.PointerEvent) => {
      clearTimeout(pendingSwitch.current);
      if (e !== undefined) exitPoint.current = { x: e.clientX, y: e.clientY };
      dispatch({ type: "leave" });
    },
    enterCard: () => {
      clearTimeout(pendingSwitch.current);
      dispatch({ type: "enter-card" });
    },
  });
  /** Any move inside the tree: heading for the open card holds it; anywhere else (off its row) lets it close. */
  const onTreePointerMove = (e: React.PointerEvent) => {
    if (openKey.current === null || compact) return;
    // The card is portaled but still bubbles React events through this tree.
    if ((e.target as HTMLElement).closest("[data-theme-card]")) return;
    const onRow = (e.target as HTMLElement).closest<HTMLElement>("[data-card-key]")?.dataset.cardKey;
    if (onRow === openKey.current) return;
    const rect = document.querySelector("[data-theme-card]")?.getBoundingClientRect();
    const heading = exitPoint.current !== null && rect !== undefined &&
      inTriangle({ x: e.clientX, y: e.clientY }, exitPoint.current, { x: rect.left, y: rect.top - 4 }, { x: rect.left, y: rect.bottom + 4 });
    dispatch(heading ? { type: "enter-card" } : { type: "leave" });
  };

  // Content height, capped so bb's list keeps LIST_RESERVE_PX below us.
  useLayoutEffect(() => {
    const measure = () => {
      const top = body.current?.getBoundingClientRect().top;
      if (top !== undefined) setMaxHeight(Math.max(120, window.innerHeight - top - LIST_RESERVE_PX));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  // The pending close fires after CLOSE_DELAY_MS unless the pointer came back.
  useEffect(() => {
    if (card.closing === null) return;
    const gen = card.closing;
    const timer = setTimeout(() => dispatch({ type: "close-timer", gen }), CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [card.closing]);
  useEffect(() => {
    if (card.key === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ type: "escape" });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card.key]);

  const byId = new Map(threads.map((t) => [t.id, t]));
  const visible = (themes ?? [])
    .map((t) => ({ ...t, thread: byId.get(t.threadId) }))
    .filter((t): t is ThemeData & { thread: PluginSidebarThread } => t.thread !== undefined && !t.thread.isArchived)
    .sort((a, b) => a.thread.displayTitle.localeCompare(b.thread.displayTitle));
  const attentionTotal = visible.reduce((n, t) => n + t.tasks.filter((task) => task.attention).length, 0);

  const addToChat = (themeId: string, task: TaskView) => {
    insertStore.set({
      threadId: themeId,
      mention: { provider: MENTION_PROVIDER, id: `${themeId}~${task.id}`, label: `task · ${task.displayTitle}` },
      quote: `task: ${task.displayTitle}${task.line ? ` — ${task.line.text}` : ""}`,
      at: Date.now(),
    });
    dispatch({ type: "escape" });
    setSheetTask(null);
    actions.open(themeId);
  };

  // ↑/↓ move between visible rows; ←/→ collapse/expand.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(body.current?.querySelectorAll<HTMLElement>("[data-theme-row]") ?? []);
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  if (themes !== null && visible.length === 0) return null;

  return (
    <CompactContext.Provider value={compact}>
    <section aria-label="Themes" className="mt-2 flex min-h-0 flex-col text-sm">
      <div className="group/head mx-2 flex h-7 items-center rounded-[10px] pl-2 pr-1 text-xs text-muted-foreground">
        <button type="button" onClick={expanded.toggleSection} aria-expanded={!expanded.collapsed} className="flex items-center gap-1 rounded outline-none focus-visible:ring-1 focus-visible:ring-ring">
          Themes
          <span className={cn("opacity-0 transition-opacity group-hover/head:opacity-100", (expanded.collapsed || compact) && "opacity-100")}>
            {svg(<path d="m6 9 6 6 6-6" />, cn("transition-transform", expanded.collapsed && "-rotate-90"), 12)}
          </span>
        </button>
        <span className="flex-1" />
        {expanded.collapsed && attentionTotal > 0 ? <span className={cn("mr-1.5 text-xs", ATTN_TEXT)}>{attentionTotal} needs you</span> : null}
        <button
          type="button"
          aria-label="New theme"
          title="New theme"
          onClick={() => {
            armTheme(rpc, true);
            actions.openNewThread({ focusPrompt: true });
          }}
          className={cn("grid size-6 place-items-center rounded-[7px] text-muted-foreground opacity-0 outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover/head:opacity-100", compact && "opacity-100")}
        >
          {svg(<path d="M12 5v14M5 12h14" />, undefined, 15)}
        </button>
      </div>
      {expanded.collapsed ? null : (
        <div ref={body} role="tree" aria-label="Themes, tasks and threads" onKeyDown={onKeyDown} onPointerMove={onTreePointerMove} onPointerLeave={() => card.key !== null && dispatch({ type: "leave" })} style={{ maxHeight }} className="min-h-0 overflow-y-auto px-2 pb-0.5 [scrollbar-width:thin]">
          {visible.map(({ thread, tasks }) => {
            const open = expanded.isOpen(thread.id) && tasks.length > 0;
            const attention = tasks.filter((t) => t.attention).length;
            const running = tasks.some((t) => t.status === "running");
            const trail: ReactNode[] = [];
            if (attention > 0) trail.push(<span key="a" title={`${attention} need you`} className={cn("inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-[11.5px] font-medium", PILL.attn)}>{Glyph.attn(11)}{attention}</span>);
            if (running) trail.push(<span key="r">{Glyph.run()}</span>);
            if (thread.isUnread) trail.push(<span key="u" aria-label="Unread" className="size-1.5 rounded-full bg-primary" />);
            if (trail.length === 0 && tasks.length > 0) trail.push(<span key="n" className="text-xs tabular-nums text-muted-foreground">{tasks.length}</span>);
            return (
              <div key={thread.id}>
                <RowMenu
                  items={[
                    ["Open", () => actions.open(thread.id)],
                    ["Open in split", () => actions.open(thread.id, { split: true })],
                    ["Rename", () => setRenaming(`theme:${thread.id}`)],
                    ["Mark as read", () => void actions.setRead(thread.id, true)],
                    ["Remove from Themes", () => void rpc.call("theme_set", { threadId: thread.id, on: false })],
                  ]}
                >
                  <div
                    data-theme-row
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={tasks.length > 0 ? open : undefined}
                    aria-selected={activeThreadId === thread.id}
                    tabIndex={0}
                    onClick={() => actions.open(thread.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      setRenaming(`theme:${thread.id}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") actions.open(thread.id);
                      if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) expanded.toggle(thread.id);
                    }}
                    className={cn(rowBase, compact ? "h-10" : "h-7", rowState(activeThreadId === thread.id), renaming === `theme:${thread.id}` && "pr-0")}
                  >
                    {renaming === `theme:${thread.id}` ? (
                      <InlineRename
                        initial={thread.displayTitle}
                        label={`Rename ${thread.displayTitle}`}
                        onDone={(title) => {
                          setRenaming(null);
                          if (title !== null) void actions.rename(thread.id, title);
                        }}
                      />
                    ) : (
                      <span className={cn("min-w-0 truncate", tasks.length === 0 && "text-muted-foreground")}>{thread.displayTitle}</span>
                    )}
                    {renaming === `theme:${thread.id}` ? null : (
                      <>
                        {tasks.length > 0 ? (
                          <button type="button" aria-label={open ? "Hide tasks" : "Show tasks"} onClick={(e) => { e.stopPropagation(); expanded.toggle(thread.id); }} onDoubleClick={(e) => e.stopPropagation()} className="grid size-4 shrink-0 place-items-center rounded-[5px] hover:bg-sidebar-accent">
                            <Chevron open={open} />
                          </button>
                        ) : null}
                        <span className="flex-1" />
                        <span className="flex items-center gap-1.5">{trail.slice(0, 2)}</span>
                      </>
                    )}
                  </div>
                </RowMenu>
                {open
                  ? tasks.map((task) => (
                      <TaskRows
                        key={task.id}
                        themeId={thread.id}
                        themeTitle={thread.displayTitle}
                        task={task}
                        compact={compact}
                        byId={byId}
                        activeThreadId={activeThreadId}
                        expanded={expanded}
                        cardOpen={card.key === `${thread.id}/${task.id}`}
                        cardEvents={cardEvents(`${thread.id}/${task.id}`)}
                        threadTitles={threadTitles}
                        onAddToChat={() => addToChat(thread.id, task)}
                        renaming={renaming === `task:${thread.id}/${task.id}`}
                        onRename={(on) => {
                          if (on) dispatch({ type: "escape" });
                          setRenaming(on ? `task:${thread.id}/${task.id}` : null);
                        }}
                        onOpenSheet={() => setSheetTask({ theme: thread.id, task })}
                      />
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      )}
      <Dialog.Root open={sheetTask !== null} onOpenChange={(o) => !o && setSheetTask(null)}>
        <Dialog.Portal>
          <Dialog.Overlay {...SCOPE} className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content {...SCOPE} aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 rounded-t-[22px] bg-popover px-[18px] pb-7 pt-2 text-[15px] leading-[22px] text-popover-foreground shadow-[0_-16px_40px_rgba(0,0,0,.35)] outline-none">
            <div className="mx-auto mb-3 h-[5px] w-[38px] rounded-full bg-muted-foreground/40" />
            <Dialog.Title className="sr-only">Task details</Dialog.Title>
            {sheetTask ? <TaskCard task={sheetTask.task} threadTitles={threadTitles} large onAddToChat={() => addToChat(sheetTask.theme, sheetTask.task)} /> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
    </CompactContext.Provider>
  );
}

function TaskRows(props: {
  themeId: string;
  themeTitle: string;
  task: TaskView;
  compact: boolean;
  byId: Map<string, PluginSidebarThread>;
  activeThreadId: string | null;
  expanded: ReturnType<typeof useExpanded>;
  cardOpen: boolean;
  cardEvents: { enter: (e?: React.PointerEvent) => void; leave: (e?: React.PointerEvent) => void; enterCard: () => void };
  threadTitles: Record<string, string>;
  onAddToChat: () => void;
  onOpenSheet: () => void;
  renaming: boolean;
  onRename: (on: boolean) => void;
}) {
  const { themeId, task, compact, expanded } = props;
  const actions = experimental_useSidebarThreadActions();
  const rpc = useRpc<typeof rpcContract>();
  const key = `${themeId}/${task.id}`;
  const open = expanded.isOpen(key);
  const { glyph, label } = STATUS[task.status];
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);
  const children = task.children.filter((c): c is ChildInfo => !c.missing);

  const row = (
    <div
      data-theme-row
      data-card-key={key}
      role="treeitem"
      aria-level={2}
      aria-expanded={open}
      aria-haspopup="dialog"
      tabIndex={0}
      onPointerEnter={compact ? undefined : props.cardEvents.enter}
      onPointerLeave={compact ? undefined : props.cardEvents.leave}
      onFocus={compact ? undefined : (e) => e.target === e.currentTarget && props.cardEvents.enter()}
      onBlur={compact ? undefined : (e) => e.target === e.currentTarget && props.cardEvents.leave()}
      onPointerDown={
        compact
          ? () => {
              pressed.current = false;
              press.current = setTimeout(() => {
                pressed.current = true;
                props.onOpenSheet();
              }, 450);
            }
          : undefined
      }
      onPointerUp={() => clearTimeout(press.current)}
      onPointerCancel={() => clearTimeout(press.current)}
      onClick={() => {
        if (pressed.current) return void (pressed.current = false);
        actions.open(themeId);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        props.onRename(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") actions.open(themeId);
        if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) expanded.toggle(key);
      }}
      className={cn(rowBase, "gap-2 pl-3.5", compact ? "h-10" : "h-7", rowState(false), props.cardOpen && "bg-sidebar-accent", props.renaming && "pr-0")}
    >
      <span className="grid w-4 shrink-0 place-items-center" aria-label={label}>{Glyph[glyph]()}</span>
      {props.renaming ? (
        <InlineRename
          initial={task.displayTitle}
          label={`Rename ${task.displayTitle}`}
          onDone={(title) => {
            props.onRename(false);
            if (title !== null) void rpc.call("task_rename", { coordinatorId: themeId, taskId: task.id, title }).catch(() => undefined);
          }}
        />
      ) : (
        <span className={cn("min-w-0 truncate", task.attention && ATTN_TEXT)}>{task.displayTitle}</span>
      )}
      {props.renaming ? null : children.length > 0 ? (
        <button type="button" aria-label={open ? "Hide threads" : "Show threads"} onClick={(e) => { e.stopPropagation(); expanded.toggle(key); }} onDoubleClick={(e) => e.stopPropagation()} className="grid size-4 shrink-0 place-items-center rounded-[5px] hover:bg-sidebar-accent">
          <Chevron open={open} />
        </button>
      ) : null}
      {props.renaming ? null : <span className="flex-1" />}
      {compact && !props.renaming ? (
        <button type="button" aria-label="Task details" onClick={(e) => { e.stopPropagation(); props.onOpenSheet(); }} className="grid size-[26px] place-items-center rounded-lg text-muted-foreground">
          {svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, undefined, 16)}
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      <RowMenu items={[["Open theme chat", () => actions.open(themeId)], ["Add to chat", props.onAddToChat], ["Rename", () => props.onRename(true)]]}>
        {compact ? (
          row
        ) : (
          <HoverCard.Root open={props.cardOpen} onOpenChange={() => undefined} openDelay={0} closeDelay={CLOSE_DELAY_MS}>
            <HoverCard.Trigger asChild>{row}</HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Content
                {...SCOPE}
                data-theme-card
                side="right"
                align="start"
                sideOffset={14}
                alignOffset={-10}
                collisionPadding={8}
                onPointerEnter={props.cardEvents.enterCard}
                onPointerLeave={props.cardEvents.leave}
                onFocus={props.cardEvents.enterCard}
                className="z-50 w-80 rounded-[15px] bg-popover p-3.5 pb-3 text-[13px] font-normal leading-5 text-popover-foreground shadow-[0_0_0_1px_var(--border),0_16px_32px_-8px_rgba(0,0,0,.45)] outline-none"
              >
                {/* Invisible bridge over the gutter between the row and the card. */}
                <span aria-hidden className="absolute -left-[16px] top-0 h-full w-[16px]" />
                <TaskCard task={task} threadTitles={props.threadTitles} onAddToChat={props.onAddToChat} />
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
        )}
      </RowMenu>
      {open
        ? children.map((child) => {
            const live = props.byId.get(child.id);
            return (
              <RowMenu
                key={child.id}
                items={[
                  ["Open", () => actions.open(child.id)],
                  ["Open in split", () => actions.open(child.id, { split: true })],
                  ["Make this a theme", () => void rpc.call("theme_set", { threadId: child.id, on: true })],
                ]}
              >
                <div
                  data-theme-row
                  role="treeitem"
                  aria-level={3}
                  tabIndex={0}
                  onClick={() => actions.open(child.id)}
                  onKeyDown={(e) => e.key === "Enter" && actions.open(child.id)}
                  className={cn(rowBase, "gap-2 pl-10 text-[0.96em]", compact ? "h-9" : "h-[26px]", props.activeThreadId === child.id ? rowState(true) : cn(rowState(false), "text-muted-foreground"))}
                >
                  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", childDot(child))} />
                  <span className="min-w-0 flex-1 truncate">{live?.displayTitle ?? child.title}</span>
                  {live?.isUnread ? <span aria-label="Unread" className="size-1.5 rounded-full bg-primary" /> : null}
                </div>
              </RowMenu>
            );
          })
        : null}
    </>
  );
}

function TaskCard({ task, threadTitles, onAddToChat, large }: { task: TaskView; threadTitles: Record<string, string>; onAddToChat: () => void; large?: boolean }) {
  const navigate = useBbNavigate();
  const { glyph, label } = STATUS[task.status];
  const line = task.line;
  return (
    <div>
      <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full pl-1.5 pr-2 text-[11.5px] font-medium", PILL[glyph])}>
        {Glyph[glyph](12)}
        {label}
      </span>
      <div className={cn("mb-0.5 mt-2 font-semibold tracking-[-0.005em]", large ? "text-[17px] leading-6" : "text-[14px] leading-5")}>{task.displayTitle}</div>
      {line !== null && line.text !== "" ? (
        <div
          className={cn(
            "break-words [&_[data-markdown-preview]]:inline [&_p]:m-0 [&_p]:inline",
            line.needsYou ? cn(ATTN_TEXT, "[&_[data-markdown-preview]]:!text-inherit [&_[data-markdown-preview]_*]:!text-inherit") : "text-muted-foreground",
          )}
        >
          {segments(line.text).map((part, i) =>
            part.kind === "text" ? (
              <Markdown key={i} content={part.text} />
            ) : (
              <button key={i} type="button" onClick={() => navigate.toThread(part.id)} className="mx-0.5 inline-block max-w-[15rem] truncate rounded border border-border px-1 align-bottom text-[12px] leading-[18px] text-foreground hover:bg-sidebar-accent">
                {threadTitles[part.id] ?? "thread"}
              </button>
            ),
          )}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onAddToChat}
          className={cn("inline-flex items-center gap-1.5 rounded-[10px] bg-primary/15 font-medium text-primary outline-none hover:bg-primary/25 focus-visible:ring-1 focus-visible:ring-ring", large ? "h-10 pl-3 pr-4 text-[15px]" : "h-7 pl-2 pr-3 text-[12.5px]")}
        >
          {svg(<path d="M12 5v14M5 12h14" />, undefined, 14)}
          Add to chat
        </button>
        <span className={cn("ml-auto text-muted-foreground", large ? "text-[13px]" : "text-[11.5px]")}>updated {ago(task.lastUpdatedAt)}</span>
      </div>
    </div>
  );
}

/** Right-click menu. Off on touch viewports, where long-press opens the task sheet instead. */
function RowMenu({ items, children }: { items: [string, () => void][]; children: ReactNode }) {
  const compact = useContext(CompactContext);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={compact}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...SCOPE} onCloseAutoFocus={(e) => e.preventDefault()} className="z-50 min-w-[200px] rounded-[15px] bg-popover p-1.5 text-[13px] text-popover-foreground shadow-[0_0_0_1px_var(--border),0_12px_28px_-8px_rgba(0,0,0,.35)]">
          {items.map(([label, run]) => (
            <ContextMenu.Item key={label} onSelect={run} className="flex h-[30px] cursor-default select-none items-center rounded-[10px] px-2.5 outline-none data-[highlighted]:bg-sidebar-accent">
              {label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ---------------------------------------------------------------- composer pieces
/** New-thread toolbar toggle. While on, the backend tags the next new root thread as a theme. */
export function ThemeToggle() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const on = useStore(toggleStore);
  useEffect(
    () =>
      composer.experimental_onSubmitted(() => {
        if (!toggleStore.get()) return;
        toggleStore.set(false);
        // The dispatch hook consumes the arm; this only clears a leftover one.
        setTimeout(() => rpc.call("theme_arm", { armed: false }).catch(() => undefined), 5000);
      }),
    [composer, rpc],
  );
  return (
    <button
      type="button"
      aria-pressed={on}
      title="Make this a theme"
      onClick={() => armTheme(rpc, !on)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[12.5px] border pl-2 pr-2.5 text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-ring",
        on ? "border-transparent bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-sidebar-accent",
      )}
    >
      {LayersIcon()}
      Theme
    </button>
  );
}

export function ThemeBanner() {
  const on = useStore(toggleStore);
  if (!on) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-[12.5px] border border-border bg-card px-3 py-2.5">
      <span className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">{LayersIcon(15)}</span>
      <div>
        <div className="font-semibold">New theme</div>
        <p className="m-0 text-[12.5px] leading-[18px] text-muted-foreground">
          This thread looks after a stream of work. It answers quick questions itself, delegates real work to child threads, and keeps their tasks under Themes.
        </p>
      </div>
    </div>
  );
}

/** Mounted (invisibly) in every thread composer; inserts an "Add to chat" task chip when its thread is the target. */
export function TaskInserter() {
  const composer = useComposer();
  const request = useStore(insertStore);
  useEffect(() => {
    if (request === null || composer.scope.kind !== "thread" || composer.scope.threadId !== request.threadId) return;
    insertStore.set(null);
    if (Date.now() - request.at > 15_000) return;
    try {
      composer.insertMention(request.mention);
    } catch {
      composer.addQuote(request.quote);
    }
    composer.focus();
  }, [request, composer]);
  return null;
}
