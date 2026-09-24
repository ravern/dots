# Reasoning Slider

Personal bb plugin: replaces the model picker's reasoning buttons with a
slider modelled on the Codex desktop app's (pill track, blue fill, stop dots,
white thumb, blue→purple at the top level).

- Drag the thumb (previews while dragging, applies on release), click
  anywhere on the track, or focus it and use ← → / Home / End.
- bb's own buttons stay in the page, hidden; the slider clicks them, so the
  level is set by bb itself and ⌥T / model switches show up in the slider.
- Restyle from a theme: override `--rs-fill`, `--rs-fill-max`, `--rs-track`,
  `--rs-thumb`, `--rs-height` on `.rs-root`.

Relies on bb's picker markup (`role="radiogroup"` labelled "Reasoning" with
`role="radio"` buttons). If a bb update changes that, the plain buttons come
back and nothing breaks.

- Check: `node --experimental-strip-types app.test.ts`
- After edits: `bb plugin build && bb plugin reload reasoning-slider`
- Remove: `bb plugin uninstall reasoning-slider --yes`
