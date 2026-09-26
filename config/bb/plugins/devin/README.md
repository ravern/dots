# Devin Cloud

Personal bb plugin: **Devin Cloud** in bb's provider picker. Each thread is a
Devin Cloud session on Devin's hosted VM, driven over ACP by
`devin acp --cloud` (Devin CLI ≥ 3000.11, logged in with `devin auth login`).

- **Repo**: a new session clones the Devin-connected repo that matches the
  workspace's `origin` (e.g. `greptileai/greptilia`). No match: no repo.
- **Models**: Devin Cloud's versions (Fusion, SWE-2, Lite, …) as advertised by
  the agent. No reasoning levels; permission mode is Full access (the cloud
  agent never asks for approval).
- **Session URL**: thread header **Devin ↗** opens it in Devin's web app.
- **VM terminal**: a "Devin VM" thread terminal runs `devin ssh <session>` in
  `~/repos/<name>`, opened automatically when the session exists and reopened
  after it exits (not after you close it). Header **VM** or `bb devin vm`
  reopens it. First connect asks to trust `ssh.devin.ai`.
- **Resume**: threads reload the same cloud session (`session/load`) after the
  agent process restarts, including across bb restarts.

How: `host.ts` reuses the SDK's ACP bridge and routes cloud launches through
`relay.ts` (the same bundled file re-run with a flag), which tags
`devin_version` as the model option and picks the repo before the first
prompt. `server.ts` derives the session URL from the thread's
`thread/identity` event and manages the terminal.

Check: `node --experimental-strip-types relay.test.ts`

Logo: Cognition mark from https://cognition.com/icon.svg, made monochrome.
