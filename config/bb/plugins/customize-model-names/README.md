# Customize Model Visibility

Personal bb plugin that changes how model names are *displayed* and which
models the model picker shows. Model ids and
what bb sends to providers are unchanged; text you type is never touched;
disabling the plugin restores bb's own labels.

**Built-in GPT rule** (on by default): `6-Astra` / `GPT-6-Astra` → `GPT-6 Astra`,
`5.6-Sol` → `GPT-5.6 Sol`, `5.5` → `GPT-5.5`. Bare picker labels like `5.5`
are only rewritten inside the model picker.

**Custom renames**: exact label matches, anywhere in bb; they win over the GPT
rule. An empty "to" hides the label.

**Visible models** ("show only"): per provider, the model picker hides rows
that match none of the provider's patterns. A pattern is bb's own label
(`Opus 5.5`, not a renamed one) or a model id (`claude-opus-5-5`),
case-insensitive, with a trailing `*` wildcard (`GPT-6*`). Providers without a
list are unchanged. The selected (checked) row always shows, typing in the
picker's search shows every match, and "More models" is hidden while a list
applies. Picker only; threads keep their models. Default:
`{"claude-code": ["Opus 5.5", "Fable 5.1"], "codex": ["GPT-6*"]}`.

## Manage

- Settings → Installed plugins → Customize Model Visibility → **Renames** panel.
- CLI:
  - `bb model-names list [--json]`
  - `bb model-names add "<from>" "<to>"`
  - `bb model-names remove "<from>"`
  - `bb model-names gpt-style on|off`
  - `bb model-names visible [--json]`
  - `bb model-names visible-add <provider> "<pattern>"`
  - `bb model-names visible-remove <provider> ["<pattern>"]` (no pattern: show all)
- Settings → Installed plugins → Customize Model Visibility → **Visible models** panel
  (or the raw "Show only these models" JSON setting).

## Develop

- Logic: `rename.ts`; check: `node --experimental-strip-types app.test.ts`
- After edits: `bb plugin build && bb plugin reload customize-model-names`
- Remove: `bb plugin uninstall customize-model-names --yes`
