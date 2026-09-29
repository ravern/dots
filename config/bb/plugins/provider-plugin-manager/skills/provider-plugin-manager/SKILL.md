---
name: provider-plugin-manager
description: Where users manage the agents' own plugins and MCP logins (Claude Code, Codex, Cursor, Devin) in bb, and what each agent's CLI supports.
---

# Provider Plugin Manager

The sidebar's **Provider Plugins** page has one tab per running bb agent provider, a machine
picker, and three views per provider: **Installed**, **Store** and **Connections** (MCP servers).
It runs that agent's own CLI on the picked machine.

| Provider | Installed | Store | Connections |
| --- | --- | --- | --- |
| Claude Code (`claude`) | list, enable/disable, update, uninstall (user scope) | every configured marketplace's catalog; add/remove/refresh marketplaces | `claude mcp list` health; log in, log out |
| Codex (`codex`) | list, uninstall | `codex plugin list --available` (most remote entries aren't installable and are hidden); marketplaces | `codex mcp list` login state; log in, log out |
| Cursor (`cursor-agent`) | not listable by its CLI | none: install via `cursor-agent` → `/plugins`, or the Cursor app; marketplaces only | `cursor-agent mcp list`; log in, enable, disable |
| Devin Cloud (`devin`) | list, update, uninstall | github.com/CognitionAI/devin-marketplace (sparse clone on the machine); install from source | `devin mcp list` (no status); log in, log out |

Icons come from the plugins' own manifests (Codex `interface.composerIcon`/`logo`, Cursor/Codex
manifests shipped inside Claude plugins, Devin's `logo`), read from the machine through the
plugin's host; everything else shows a letter avatar.

Logins need a TTY, so **Log in** starts `<cli> mcp login <server>` in a machine-scoped bb
terminal and shows it in the page's right-panel **Login** tab (also `bb terminal attach <id>`).
A server that fails on a fixed Authorization header (e.g. an unset env var) can't be fixed by
logging in; fix the value it reads.

Changes apply to new agent processes: "Restart idle … threads" stops idle threads of that
provider on that machine; each resumes on its next message. From a thread, run the same CLI
commands directly instead.
