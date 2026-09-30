# Antigravity provider

Personal bb plugin: **Antigravity** in bb's provider picker. Threads run
Google's Antigravity CLI (`agy`, `brew install --cask antigravity-cli`) through
a native provider bridge, since agy has no ACP mode. Sign in once by running
`agy` in a terminal.

- `server.ts` registers the provider (Full access / Accept edits, per-model
  reasoning levels, host-scoped model list, health).
- `host.ts` is the bridge: one `agy --print= --input-format stream-json
  --output-format stream-json` process per turn, `--conversation <id>` to
  resume. agy's `step_update` events map to bb items (answers stream as text;
  `run_command` → command, `view_file` → file read, file writes → file change,
  `search_web`/`read_url_content` → web search/fetch, everything else → tool),
  `result` settles the turn with usage, denied actions become a warning.
- Models: `agy models` rows; `<family>-<effort>` ids collapse into one model
  with reasoning levels, sent as `--model <family> --effort <level>`.

See `skills/antigravity-provider/SKILL.md` for settings and constraints.

Check: `node --experimental-strip-types host.test.ts` (model parsing, then the
SDK's bridge conformance suite against `fake-agy.mjs`, a replay of real agy
stream-json shapes).
