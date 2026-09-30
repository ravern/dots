import type { BbPluginApi } from "@get-bb/plugin-sdk";

// agy's headless mode can't ask for approval: Full access skips permissions, Accept edits
// runs `--mode accept-edits` (commands are auto-denied). Plan mode isn't offered because
// headless agy doesn't enforce it. Reasoning levels are per model (from `agy models`).
export default function antigravity(bb: BbPluginApi) {
  bb.providers.register({
    id: "antigravity",
    displayName: "Antigravity",
    icon: "./icons/antigravity.svg",
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full", "accept-edits"],
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: [],
    completedTurnDisplay: "collapse",
    strings: {
      signInHint: "Run `agy` in a terminal and complete the Google sign-in.",
      expiredHint: "Your Antigravity sign-in expired. Run `agy` in a terminal to sign in again, then retry.",
      installUrl: "https://antigravity.google",
      iconTint: { light: "#1A73E8", dark: "#8AB4F8" },
    },
    models: { scope: "host" },
  });
}
