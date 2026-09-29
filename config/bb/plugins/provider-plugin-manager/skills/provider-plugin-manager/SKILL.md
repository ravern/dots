---
name: provider-plugin-manager
description: Where users manage the agents' own plugins (Claude Code, Codex, Cursor, Devin) in bb, and what each agent's plugin CLI supports.
---

# Provider Plugin Manager

The sidebar's **Provider Plugins** page has one tab per running bb agent provider, plus a
machine picker. It runs that agent's own plugin CLI on the picked machine.

| Provider | CLI | Supported |
| --- | --- | --- |
| Claude Code (`claude-code`) | `claude plugin …` | list, enable/disable, update, uninstall (user scope), browse + install, marketplaces add/remove/update |
| Codex (`codex`) | `codex plugin …` | list, uninstall, browse + install, marketplaces add/remove/upgrade |
| Cursor (`acp-cursor`) | `cursor-agent plugin marketplace …` | marketplaces only (plugins install per account in Cursor) |
| Devin Cloud (`devin-cloud`) | `devin plugins …` | list, update, uninstall, install from source (personal plugins) |

Other providers show "not supported yet". Changes apply to new agent processes: the page's
"Restart idle … threads" stops idle threads of that provider on that machine; each resumes on
its next message. To change plugins from a thread instead, run the same CLI commands directly.
