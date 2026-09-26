// Adapted from ChrBoebel/bb-plugin-provider-brand-marks ("True Colors") v0.1.2,
// MIT — see LICENSE-provider-brand-marks. Companion rules for usage plugins
// that aren't installed here were dropped.
import type { definePluginApp } from "@get-bb/plugin-sdk/app";

/**
 * bb draws every provider mark as a monochrome CSS mask on a
 * `<span data-provider-logo="/api/v1/system/providers/<id>/logo?h=<hash>">`
 * that paints itself with Tailwind's `bg-current`. When the provider plugin
 * declares `strings.iconTint`, bb wraps that span in a
 * `<span data-provider-icon-tint="<id>">` carrying an inline `color`.
 *
 * Both are internal DOM details rather than a public API, so every selector
 * here matches on the URL *prefix* (the `?h=` hash changes whenever bb swaps
 * a logo file) and the whole stylesheet degrades to a no-op if bb ever stops
 * emitting these attributes — CSS that matches nothing changes nothing.
 */
const LOGO_URL_PREFIX = "/api/v1/system/providers/";

/**
 * Brand colours as published by each vendor. Sources are listed in README.md.
 * These are the *unmodified* originals; the palette fitting happens in CSS so
 * a user can retune or override any of it from their own theme.
 */
const BRAND_COLORS: Readonly<Record<string, string>> = {
  "claude-code": "#D97757",
  codex: "#10A37F",
  pi: "#6A9FCC",
  "acp-hermes-agent": "#0000F2",
  "acp-opencode": "#B8C425",
};

/**
 * Providers whose mark is deliberately monochrome (Cursor's is black on light,
 * white on dark). Chasing a hue for these would invent branding they do not
 * have, so they track the palette's own foreground instead.
 */
const MONOCHROME_PROVIDERS: readonly string[] = ["acp-cursor"];

/** CSS custom property holding a provider's origin colour. */
const brandVar = (providerId: string) => `--pbm-brand-${providerId}`;

/** Both surfaces bb may use for one provider: the mask span and the tint hull. */
const selectorsFor = (providerId: string) => ({
  logo: `[data-provider-logo^="${LOGO_URL_PREFIX}${providerId}/logo"]`,
  tint: `[data-provider-icon-tint="${providerId}"]`,
});

/**
 * Fit a brand colour to the active palette without knowing anything about it:
 * keep the hue, pull chroma back toward the muted end most bb palettes sit at,
 * and pin lightness to a value that clears WCAG's 3:1 non-text contrast bar on
 * both a light and a dark canvas. Relative colour syntax does this per-repaint,
 * so it follows theme switches with no JavaScript.
 */
const tuned = (providerId: string) =>
  `oklch(from var(${brandVar(providerId)}) var(--pbm-lightness) ` +
  `min(calc(c * var(--pbm-chroma-scale)), var(--pbm-chroma-cap)) h)`;

function buildStylesheet(): string {
  const brandDeclarations = Object.entries(BRAND_COLORS)
    .map(([providerId, hex]) => `  ${brandVar(providerId)}: ${hex};`)
    .join("\n");

  const brandRules = Object.keys(BRAND_COLORS)
    .map((providerId) => {
      const { logo, tint } = selectorsFor(providerId);
      // `!important` is needed on the tint hull to beat bb's inline `color`,
      // and is kept on the mask for symmetry with it.
      return (
        `${logo} { background-color: ${tuned(providerId)} !important; }\n` +
        `${tint} { color: ${tuned(providerId)} !important; }`
      );
    })
    .join("\n");

  const monochromeRules = MONOCHROME_PROVIDERS.map((providerId) => {
    const { logo, tint } = selectorsFor(providerId);
    return (
      `${logo} { background-color: var(--foreground) !important; }\n` +
      `${tint} { color: var(--foreground) !important; }`
    );
  }).join("\n");

  return [
    "/* Provider brand marks — injected by Customize Model Picker.",
    "   Every value below is a custom property, so a theme can override any",
    "   single provider colour or the whole tuning without forking this. */",
    ":root {",
    "  /* Nord's most saturated accent sits at chroma 0.121; capping just above",
    "     it keeps a loud brand (Hermes' #0000F2 is 0.301) from shouting. */",
    "  --pbm-chroma-scale: 0.85;",
    "  --pbm-chroma-cap: 0.125;",
    "  --pbm-lightness: 0.6;",
    brandDeclarations,
    "}",
    ".dark { --pbm-lightness: 0.75; }",
    "",
    brandRules,
    "",
    monochromeRules,
    "",
  ].join("\n");
}

type PluginApp = Parameters<Parameters<typeof definePluginApp>[0]>[0];

/** Tints provider logos in their brand colours, fitted to the palette. */
export function registerBrandMarks(app: PluginApp) {
  app.contentScripts.register({
    id: "brand-marks",
    mount({ pluginId }) {
      // Relative colour syntax carries the whole feature. Without it the rules
      // would compute to nothing useful, so leave bb's own colours alone.
      if (!CSS.supports("color", "oklch(from #000 l c h)")) return;

      const style = document.createElement("style");
      style.dataset.bbPlugin = pluginId;
      style.textContent = buildStylesheet();
      document.head.append(style);

      return () => style.remove();
    },
  });
}
