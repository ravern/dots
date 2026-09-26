---
name: devin-cloud
description: Find a Devin Cloud thread's session URL or open a terminal on its Devin VM with `bb devin vm`. Use when the user wants to look at, shell into, or open in Devin's web app a thread running on the Devin Cloud provider.
---

# Devin Cloud

Threads on the **Devin Cloud** provider (`devin-cloud`) run as Devin Cloud
sessions on Devin's hosted VM, not in the local workspace. The thread header
shows **Devin ↗** (the session in Devin's web app) and **VM** (a terminal).

bb opens a thread terminal titled "Devin VM" running `devin ssh <session>` in
the session's repo (`~/repos/<name>`) once the session exists, and reopens it
after it exits unless the user closed it.

| Command | Effect |
| --- | --- |
| `bb devin vm [thread-id]` | Print the session URL and open (or reopen) the VM terminal. Defaults to the current thread. |

The first connection asks to trust the `ssh.devin.ai` host key in the terminal.
