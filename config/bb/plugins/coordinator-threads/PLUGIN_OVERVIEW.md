A **Tasks** panel beside a coordinator thread: every child thread grouped
into tasks, its live state, and the coordinator's saved report.

## What you get

- A **View tasks** thread-panel action that opens a Tasks tab listing open
  tasks (Task, Status, Description, Threads, Updated), needs-attention first,
  with one status per task.
- A **Themes** section in the left sidebar: theme threads, their open
  tasks and each task's threads, with an instant hover card and "Add to chat".
- A **Theme** toggle on the new-thread screen, and standing theme
  instructions for threads marked as themes.
- A `bb coordinator-threads` command coordinators use to save reports, name
  and close tasks, and group several child threads into one task.

## How it works

Tasks are stored in the coordinator thread's own plugin metadata. Child
threads without a task appear automatically. Runtime state (running, needs
approval, idle) is read from the child threads; the outcome and description
come only from the coordinator's report. Nothing leaves the
machine and no model calls or background work maintain the list.
