# Coordinator Threads

bb plugin (`coordinator-threads`). "View tasks" thread-panel action (opens a Tasks tab
of open tasks: Task | Status | Description | Threads | Updated) + report/task CLI.

```sh
tr '\n' ' ' <<'JSON' | bb coordinator-threads report <task-or-child-id> [--close] [--coordinator <id>] --report-stdin
{"outcome":"done","title":"unread dot colour","description":"unread dot now blue in [ravern theme](/path/ravern.css)","needsYou":null}
JSON
bb coordinator-threads task new --title "…" [--child <id>]… [--brief …]
bb coordinator-threads task link <task-id> <child-id>
bb coordinator-threads task rename <task-id> "<title>"
bb coordinator-threads task list [--all] [--json]
```

- Naming rule for coordinators: spawn children with
  `bb thread spawn --title "<concise lowercase title>"` (2–5 words, lowercase, no trailing
  punctuation, e.g. "hide more models button") and give each task a short lowercase
  `title` in its report. Rename old children with `bb thread update <id> --title "…"`.
- `description`: one plain phrase, ≤10 words (rejected if longer; `result` is its legacy
  name). `needsYou` ≤15 words; when set it replaces the description in the cell.
  No bare file names/paths in either: link files as `[plan](/path/plan.md)` (rendered with
  bb's Markdown, so local files open in bb's viewer; link text counts as words, the URL
  doesn't). No semicolons in either (one short phrase). No raw ids except threads: `@thread:thr_…`/`thr_…` render as clickable thread
  chips (one word each); other bb ids (`auto_…`, `proj_…`, `env_…`, `t_…`, …) are rejected,
  so describe them in words. Saved reports aren't rewritten: thread ids still render as
  chips, other ids show as-is until re-saved. `undo`/`verified`/`notVerified` are no
  longer used (accepted and ignored). Text rules live in `text.ts` (shared by CLI and panel).
- One status per task: needs approval → needs you → running → done/blocked/failed/cancelled
  → awaiting report (logic and tests in `tasks.ts` / `tasks.test.ts`). A report made stale by
  a resumed child only affects priority; nothing "previous" is displayed.
- The panel shows open tasks only; closed tasks stay in metadata (`task list --all`).
- bb 0.43.4's CLI forwards only one-line `--<flag>-stdin`; `--stdin`/`--input-text` is
  accepted for CLIs that forward multiline stdin and errors clearly otherwise.
- Storage: coordinator thread plugin metadata `{ version: 1, tasks: [...] }`,
  capped at 192 KiB (reports ≤ 8 KiB); oldest `--close`d tasks are pruned first.
- Direct children with no task show as implicit tasks (`t_<child id>`), not
  written until a command touches them.
- Files: `tasks.ts` (pure model), `server.ts` (SDK, CLI, RPC), `app.tsx` (panel),
  `skills/coordinator-threads/SKILL.md` (agent usage).
- Test: `node --experimental-strip-types tasks.test.ts`. Build: `bb plugin build`.
- Uninstall: `bb plugin uninstall coordinator-threads --yes`.

## Themes

- A theme is a coordinator thread with `role: "theme"` in this plugin's thread metadata.
  Themes get standing instructions (`THEME_INSTRUCTIONS` in `server.ts`) and the `theme` +
  `coordinator-threads` skills via `bb.agents.configure`; every other thread gets neither.
- Mark or unmark: the new-thread composer's **Theme** toggle (arms the `message.dispatch`
  hook, which tags the next user-created root thread), the Themes `+` button,
  "Make this a theme" / "Remove from Themes" in the section's context menus, or
  `bb coordinator-threads theme add|remove <thread-id>` / `theme list`.
  Themes are filed into the theme section (kv `themeSection`, the first theme's section).
- Sidebar: `experimental_sidebarNavigation` renders bb's nav, then the Themes section
  (`themes.tsx`), when the **Show Themes in sidebar** setting is on
  (`bb plugin config coordinator-threads set themesInSidebar false` to turn it off).
  Theme → task (status icon, title; click opens the theme chat) → threads. Hovering or
  focusing a task opens its card at once (`hover.ts`: 140ms close delay, safe triangle).
  Phone: ⓘ or long-press opens the card as a bottom sheet.
- "Add to chat" opens the theme and inserts a `task · <title>` mention (provider `task`,
  resolved at send time to the task's live status, description and threads) through a
  hidden composer action; falls back to a quoted line. `@` in any composer also finds tasks.
- Tests: `node --experimental-strip-types tasks.test.ts` and `hover.test.ts`.

