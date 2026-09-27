# Devin Cloud

Personal bb plugin: **Devin Cloud** in bb's provider picker. Each thread is a
Devin Cloud session on Devin's hosted VM, driven over ACP by
`devin acp --cloud` (Devin CLI ≥ 3000.11, logged in with `devin auth login`).

- **Repo**: a new session clones the Devin-connected repo that matches the
  workspace's `origin` (e.g. `greptileai/greptilia`). No match: no repo.
- **Models**: Devin Cloud's versions (Fusion, SWE-2, Lite, …) as advertised by
  the agent. Level families collapse into one model with real reasoning
  levels: `devin-swe-2-{low,high,max}` ("SWE-2 Medium/High/Max") is **SWE-2**
  with Medium/High/Max. Families are detected from the `-low|-high|-max` id
  suffix (labels from Devin's names), so new ones collapse too. Models without
  levels show no reasoning. Permission mode is Full access (the cloud agent
  never asks for approval).
- **Priority**: a family's `-priority-` tier is bb's service-tier switch
  (declared as "Priority"; an app overlay shows bb's "Priority mode" and the
  picker summary's "(Fast mode)" as "Priority"). SWE-2 + High + Priority runs
  `devin-swe-2-priority-high`. bb shows the switch per provider, so the
  overlay hides it when the picked model has no priority tier, and the relay
  ignores a stale "on" for such models. The toggle and its picker menu carry
  `data-devin-priority="available|unavailable"` for other picker plugins.
- **Secrets**: when Devin requests a secret, the thread row reads "Devin
  needs secret NAME" and bb opens a password form: Send, "Save for future
  sessions" (Devin's Personal scope; delete saved ones at
  https://app.devin.ai/secrets), or Skip. Skip posts "Skipped NAME; continue
  without it." to the thread, since Devin's ACP has no way to decline. The server hands the value straight to
  Devin (`_cognition.ai/secret/provide` on its own `devin acp --cloud`
  connection); it isn't stored in the thread, logged, or written to a file.
  Devin's errors are reduced to their code because they echo the request.
- **Questions**: Devin's multiple-choice questions (`cognition.ai/questions`
  on its message) get a "Devin asks" row and a form (radio, or checkboxes when
  it allows several). The answer goes back as your message: Devin's ACP has no
  answer method, so Devin's own record shows the question as skipped even
  though Devin acts on the answer. A newer question replaces an unanswered
  one; forms queue one at a time per thread.
- **Updates**: agent processes outlive a plugin reinstall, so the plugin stops
  idle Devin Cloud threads on load; each picks up the new relay on its next
  message (same Devin session).
- **Old threads**: a thread that stored a pre-collapse id
  (`devin-swe-2-high`, `devin-swe-2-priority-max`) keeps that exact version;
  its stored reasoning/tier is ignored for that pick.
- **Session URL**: thread header **Open in Devin ↗** opens it in Devin's web app.
- **VM terminal**: a "Devin VM" thread terminal runs `devin ssh <session>` in
  `~/repos/<name>`, opened automatically when the session exists and reopened
  after it exits (not after you close it). **Start Devin terminal** in the side panel's
  New tab launcher (or `bb devin vm`) reopens it and shows it as a tab; bb
  lists launcher actions on every thread, so elsewhere it just says so. First connect asks to trust `ssh.devin.ai`.
- **Resume**: threads reload the same cloud session (`session/load`) after the
  agent process restarts, including across bb restarts.

How: `host.ts` reuses the SDK's ACP bridge and routes cloud launches through
`relay.ts` (the same bundled file re-run with a flag), which presents
`devin_version` as model + `thought_level` + `fast` options and translates
picks back, and picks the repo before the first prompt. The server probes
Devin Cloud once per plugin load for the models with a priority tier. `server.ts` derives the session URL from the thread's
`thread/identity` event and manages the terminal.

Check: `node --experimental-strip-types relay.test.ts`

Logo: Cognition mark from https://cognition.com/icon.svg, made monochrome.
