---
name: coordinator-threads
description: Record child-thread task reports, name tasks and child threads, and group child threads into tasks for the coordinator's persistent Tasks panel with `bb coordinator-threads`. Use when a coordinator thread spawns a child, receives a child's final report, closes finished work, or groups several child threads into one task.
---

# Coordinator Threads

A coordinator's open tasks show under its theme in the **Themes** sidebar
section (and in the **View tasks** panel): status, title, description.
Tasks live in the coordinator thread's plugin metadata. Each task shows one
status, in priority order: Needs approval (a child has a pending interaction)
→ Needs you (your report's `needsYou`) → Running → Done / Blocked / Failed /
Cancelled (your report's outcome) → Awaiting report (idle, no report). A
finished turn, a returned `bb thread wait`, or a "completed" notification is
**not** a finished task. If a child resumes after your report, the task shows
Running (then Awaiting report) until you record a new one.

Every direct child not linked to a task automatically shows as its own task
(id `t_<child id without thr_>`), so you normally need no setup call.
Commands default to the invoking thread as the coordinator; pass
`--coordinator <thread-id>` otherwise. Every command supports `--help` and
`--json`.

## Naming

- When spawning a child, always pass a concise lowercase title:
  `bb thread spawn --title "<concise lowercase title>" …` — 2–5 words,
  lowercase, no trailing punctuation, e.g. `"hide more models button"`.
- Give each task a short lowercase `title` in its report (same rule). A task
  without its own title shows its first child thread's title.
- Rename a task: `bb coordinator-threads task rename <task-id> "<title>"`.
- Rename an old child thread: `bb thread update <thread-id> --title "<title>"`.

## Record a report

When a child reports an outcome, save it in one call. A child thread id
resolves to its task. Repeating the call replaces the report.

```sh
tr '\n' ' ' <<'JSON' | bb coordinator-threads report <task-or-child-id> [--close] --report-stdin
{
  "outcome": "done",
  "title": "unread dot colour",
  "description": "unread dot now blue in [ravern theme](/Users/me/.bb/themes/ravern.css)",
  "needsYou": null
}
JSON
```

- bb 0.43.4 forwards `--report-stdin` as exactly one line (≤16 KiB), so flatten
  the quoted heredoc with `tr '\n' ' '` (lossless for valid JSON). Do not use
  bare `--stdin` on this bb version; it is not forwarded.
- `outcome`: `done | blocked | failed | cancelled`.
- `description` (required): one plain phrase, **≤10 words**, shown in the
  Description column. Longer text is rejected, not truncated; leave detail in
  the child thread. `result` is accepted as its legacy name.
- **No bare file names or paths** in `description` or `needsYou`. Reference a
  file only as a markdown link, e.g. `[plan](/Users/me/plan.md)`; it renders as
  a clickable link that opens in bb's file viewer. A bare `/path`, `~/path`, or
  `name.md`-style token is rejected. Link text counts toward the word limit;
  the URL doesn't.
- **No semicolons** in `description` or `needsYou`: use one short phrase.
- **No raw ids** except threads. Prefer plain words. A thread id
  (`@thread:thr_…` or `thr_…`) renders as a clickable thread chip showing the
  thread's title and counts as one word. Other bb ids (`auto_…`, `proj_…`,
  `env_…`, `host_…`, `sec_…`, `pint_…`, `t_…`) are rejected: describe the thing
  in words instead, e.g. "hourly sync automation".
- `needsYou`: a short request (**≤15 words**) or `null` (`"none"` also means
  null). When set, it is the whole message: the Description cell shows only
  "Needs you: …" (the description stays in the tooltip) and the status is
  Needs you.
- `title` (optional): concise lowercase task title; renames the task.
- Unknown keys are rejected. `undo`, `verified` and `notVerified` are no longer
  used: they are accepted and ignored.
- Never put secrets in a report. Attribute checks to the child unless you ran
  them yourself. Do not reread child logs/output just to fill the report; use
  the child's self-contained final report.

## Close fully finished work

`--close` saves the report first, then archives the task's child threads only
if: outcome is `done`/`cancelled`, `needsYou` is null, and no child or
descendant is running, queued, or awaiting approval. Otherwise it archives
nothing and exits 1 with the reasons. A partial archive failure is reported
explicitly; the report stays saved and retrying is safe. Closed tasks leave
the panel; `task list --all` still shows them.

Use `--close` only when the task is fully done. Retain recurring or ongoing
tasks. If this coordinator retains non-PR work until the user drops it
(`retainNonPr`), omit `--close` for non-PR work. A stop request alone does not
mean cancelled-and-closed.

## Group children into tasks

```sh
bb coordinator-threads task new --title "model allowlist" --child thr_a --child thr_b [--brief <path-or-line>]
bb coordinator-threads task link <task-id> <child-id>   # follow-up child, or a sibling coordinator's child by reference
bb coordinator-threads task rename <task-id> "<title>"
bb coordinator-threads task list [--all] [--json]       # ! marks needs-attention; --all includes closed history
```

Linking moves a child out of any other task. Do not reparent a sibling
coordinator's child to make the panel complete; link it instead.

## After recording

Normally reply with one line ("Done — <short result>; details are in Tasks.").
For blockers, also put the question in chat. If saving fails, say so and keep
the essential result in chat.
