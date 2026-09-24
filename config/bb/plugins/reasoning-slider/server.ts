import type { BbPluginApi } from "@get-bb/plugin-sdk";

// Frontend-only plugin; bb requires a server entry.
export default function reasoningSlider(bb: BbPluginApi) {
  bb.log.info("Reasoning Slider loaded");
}
