---
name: antigravity-provider
description: "Diagnose BB threads on the Antigravity provider (Google's `agy` CLI): sign-in, models and reasoning levels, permission modes, auto-denied actions, and resume."
---

# Antigravity provider

Threads on the **Antigravity** provider (`antigravity`) run Google's Antigravity
CLI (`agy`, Homebrew cask `antigravity-cli`) headlessly on the thread's host:
each turn is one `agy --print= --input-format stream-json --output-format
stream-json` process in the workspace, resumed with `--conversation <id>`.

Setup: `agy` on PATH (or in `/opt/homebrew/bin`), signed in once by running
`agy` in a terminal (interactive Google login). Check with `agy models`. A
missing CLI or sign-in shows as provider health (not installed /
unauthenticated) and as a turn error with the fix.

| BB setting | agy flags |
| --- | --- |
| Model `gemini-3.8-flash` + reasoning Low/Medium/High | `--model gemini-3.8-flash --effort low\|medium\|high` |
| Models without levels (`claude-sonnet-4-6`, …) | `--model <id>`, reasoning ignored |
| Full access | `--dangerously-skip-permissions` |
| Accept edits | `--mode accept-edits` |

Models come from `agy models`; `<family>-<effort>` ids collapse into one model
with those reasoning levels (agy accepts the family id plus `--effort`).

Constraints:

- Headless agy can't ask for approval. In Accept edits, shell commands (and
  writes outside trusted workspaces) are auto-denied and the turn stops; the
  thread shows "Antigravity auto-denied: …". Use Full access, or add
  `permissions.allow` rules to `~/.gemini/antigravity-cli/settings.json`.
- No plan mode: headless agy doesn't enforce it.
- No mid-turn steering: a message sent during a turn runs as the next turn.
- Thinking text isn't streamed by agy; only answers and tool steps show.
- The provider thread id is `pending-<thread>` until the first turn, then agy's
  conversation id. If agy can't find a conversation it starts a new one and
  the thread shows a warning.
- bb's instructions are prepended to the conversation's first message (agy has
  no system-prompt flag).
