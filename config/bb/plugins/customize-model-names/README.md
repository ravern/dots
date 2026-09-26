# Customize Model Picker

Personal bb plugin that changes how model names are *displayed* and which
models the model picker shows. Model ids and
what bb sends to providers are unchanged; text you type is never touched;
disabling the plugin restores bb's own labels.

**Renames**: exact label matches, anywhere in bb. An empty "to" hides the
label. The default list covers the Codex GPT-6 and GPT-5.6 models in both the
forms bb shows: `GPT-6-Sol` (threads) and `6-Sol` (picker) → `GPT-6 Sol`.

**Visible models** ("show only"): per provider, the model picker hides rows
that match none of the provider's patterns. A pattern is bb's own label
(`Opus 5.5`) or a model id (`claude-opus-5-5`),
case-insensitive, with a trailing `*` wildcard (`GPT-6*`). Providers without a
list are unchanged. A row also matches by its renamed label (`GPT-6 Astra`).
The selected (checked) row always shows, search results obey the list too, and
"More models" is hidden while a list applies. Picker only; threads keep their models. Default:
`{"claude-code": ["Opus 5.5", "Fable 5.1"], "codex": ["GPT-6*"]}`.

## Manage

- Settings → Installed plugins → Customize Model Picker → **Renames** panel.
- CLI:
  - `bb model-names list [--json]`
  - `bb model-names add "<from>" "<to>"`
  - `bb model-names remove "<from>"`
  - `bb model-names visible [--json]`
  - `bb model-names visible-add <provider> "<pattern>"`
  - `bb model-names visible-remove <provider> ["<pattern>"]` (no pattern: show all)
- Settings → Installed plugins → Customize Model Picker → **Visible models** panel
  (or the raw "Show only these models" JSON setting).

## Develop

- Logic: `rename.ts`; check: `node --experimental-strip-types app.test.ts`
- After edits: `bb plugin build && bb plugin reload customize-model-names`
- Remove: `bb plugin uninstall customize-model-names --yes`

**Reasoning slider**: replaces the picker's reasoning buttons with a slider
modelled on the Codex desktop app's (pill track, fill, stop dots, thumb).
Drag the thumb (previews while dragging, applies on release), click the
track, or focus it and use ← → / Home / End. bb's own buttons stay in the
page, hidden, and the slider clicks them, so bb sets the level itself and
⌥T / model switches show up in the slider. With one level or none (e.g.
Devin Cloud models) the whole Reasoning section is hidden. Restyle from a
theme via `--rs-fill`, `--rs-fill-max`, `--rs-track`, `--rs-thumb`,
`--rs-height` on `.rs-root`. If a bb update changes the picker markup
(`role="radiogroup"` labelled "Reasoning"), the plain buttons come back.

**Provider brand colours** (from "True Colors", ChrBoebel/bb-plugin-provider-brand-marks,
MIT — `LICENSE-provider-brand-marks`): provider logos are tinted in their brand
colour (Claude clay, OpenAI green, Pi, Hermes, OpenCode), fitted to the palette
in light and dark; Cursor tracks the foreground. Override from a theme via
`--pbm-brand-<provider-id>`, `--pbm-lightness`, `--pbm-chroma-scale`, `--pbm-chroma-cap`.

- Checks: `node --experimental-strip-types app.test.ts` and
  `node --experimental-strip-types reasoning-slider.test.ts`
- After edits: `bb plugin build && bb plugin reload customize-model-names`
