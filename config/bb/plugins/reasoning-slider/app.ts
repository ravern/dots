import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";
import { indexAtPosition, indexForKey, percentForIndex } from "./slider-math";

/**
 * Replaces bb's reasoning buttons (a Radix single toggle group labelled
 * "Reasoning" in the model picker) with a Codex-style slider. The original
 * buttons stay in the DOM, hidden; the slider clicks them, so bb sets the
 * level through its own code path and every other way of changing it
 * (⌥T, switching model) flows back into the slider.
 */

const GROUP = ':is([role="radiogroup"], [role="group"])[aria-label="Reasoning"]';
const OPTION = 'button[role="radio"]';
const HIDDEN_ATTR = "data-reasoning-slider-hidden";

interface Option {
  button: HTMLButtonElement;
  label: string;
}

function readOptions(group: Element): Option[] {
  return Array.from(group.querySelectorAll<HTMLButtonElement>(OPTION)).map((button) => ({
    button,
    label: button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
  }));
}

function selectedIndex(options: Option[]): number {
  const i = options.findIndex(
    (o) => o.button.getAttribute("data-state") === "on" || o.button.getAttribute("aria-checked") === "true",
  );
  return Math.max(0, i);
}

/** One slider bound to one bb reasoning group. */
class ReasoningSlider {
  readonly root = document.createElement("div");
  private readonly value = document.createElement("span");
  private readonly track = document.createElement("div");
  private readonly range = document.createElement("div");
  private readonly ticks = document.createElement("div");
  private readonly thumb = document.createElement("div");
  private readonly observer: MutationObserver;
  private options: Option[] = [];
  private index = 0;
  private preview: number | null = null;
  private pointerId: number | null = null;

  constructor(readonly group: HTMLElement) {
    this.root.className = "rs-root";
    this.root.setAttribute("role", "slider");
    this.root.setAttribute("aria-label", "Reasoning");
    this.root.tabIndex = 0;
    this.value.className = "rs-value";
    this.track.className = "rs-track";
    this.range.className = "rs-range";
    this.ticks.className = "rs-ticks";
    this.thumb.className = "rs-thumb";
    const header = document.createElement("div");
    header.className = "rs-header";
    header.append(this.value);
    this.track.append(this.range, this.ticks, this.thumb);
    this.root.append(header, this.track);

    this.root.addEventListener("keydown", this.onKeyDown);
    this.track.addEventListener("pointerdown", this.onPointerDown);
    this.track.addEventListener("pointermove", this.onPointerMove);
    this.track.addEventListener("pointerup", this.onPointerUp);
    this.track.addEventListener("pointercancel", this.onPointerCancel);

    group.setAttribute(HIDDEN_ATTR, "");
    group.before(this.root);

    // bb re-renders the buttons (state flips, model switch changes levels).
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(group, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-checked", "disabled", "data-disabled", "aria-label"],
    });
    this.sync();
  }

  private get disabled(): boolean {
    return (
      this.group.hasAttribute("data-disabled") ||
      this.options.length === 0 ||
      this.options.every((o) => o.button.disabled)
    );
  }

  private sync() {
    this.options = readOptions(this.group);
    this.index = selectedIndex(this.options);
    const count = this.options.length;
    if (this.ticks.childElementCount !== count) {
      this.ticks.replaceChildren(
        // No handlers: presses bubble to the track, which snaps to the
        // nearest stop, so grabbing the thumb (always over a dot) drags.
        ...this.options.map(() => {
          const tick = document.createElement("span");
          tick.className = "rs-tick";
          return tick;
        }),
      );
    }
    this.render();
  }

  private render() {
    const count = this.options.length;
    const shown = this.preview ?? this.index;
    const pct = percentForIndex(shown, count);
    const label = this.options[shown]?.label ?? "";
    this.root.style.setProperty("--rs-pct", String(pct));
    this.root.toggleAttribute("data-max", count > 1 && shown === count - 1);
    this.root.toggleAttribute("data-dragging", this.pointerId !== null);
    this.root.toggleAttribute("data-disabled", this.disabled);
    this.root.setAttribute("aria-disabled", String(this.disabled));
    this.root.setAttribute("aria-valuemin", "0");
    this.root.setAttribute("aria-valuemax", String(Math.max(0, count - 1)));
    this.root.setAttribute("aria-valuenow", String(shown));
    this.root.setAttribute("aria-valuetext", label);
    this.value.textContent = label;
    Array.from(this.ticks.children).forEach((tick, i) => {
      (tick as HTMLElement).style.left = `${percentForIndex(i, count)}%`;
      tick.toggleAttribute("data-filled", i <= shown);
      tick.setAttribute("title", this.options[i]?.label ?? "");
    });
  }

  private commit(i: number) {
    this.preview = null;
    const option = this.options[i];
    if (this.disabled || option === undefined || i === this.index) {
      this.render();
      return;
    }
    option.button.click(); // Radix onValueChange → bb sets the level
    this.index = i; // optimistic; the observer confirms from bb's state
    this.render();
  }

  private indexAt(e: PointerEvent): number {
    const rect = this.track.getBoundingClientRect();
    // Stops sit inside the track by half a thumb on each side.
    const inset = rect.height / 2;
    return indexAtPosition(e.clientX, rect.left + inset, rect.width - inset * 2, this.options.length);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.disabled || e.button !== 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.track.setPointerCapture(e.pointerId);
    this.root.focus({ preventScroll: true });
    this.preview = this.indexAt(e);
    this.render();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const next = this.indexAt(e);
    if (next !== this.preview) {
      this.preview = next;
      this.render();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.commit(this.indexAt(e));
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.preview = null;
    this.render();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.disabled) return;
    const next = indexForKey(e.key, this.index, this.options.length);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // keep the picker's own list navigation out of it
    this.commit(next);
  };

  dispose() {
    this.observer.disconnect();
    this.root.remove();
    this.group.removeAttribute(HIDDEN_ATTR);
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "reasoning-slider",
    mount({ signal }) {
      const sliders = new Map<HTMLElement, ReasoningSlider>();

      const reconcile = () => {
        for (const [group, slider] of sliders) {
          if (!group.isConnected || !slider.root.isConnected) {
            slider.dispose();
            sliders.delete(group);
          }
        }
        for (const group of document.querySelectorAll<HTMLElement>(GROUP)) {
          if (!sliders.has(group) && group.querySelector(OPTION) !== null) {
            sliders.set(group, new ReasoningSlider(group));
          }
        }
      };

      // The picker mounts and unmounts its menu; watch for groups coming and going.
      const observer = new MutationObserver((mutations) => {
        if (mutations.some((m) => m.addedNodes.length > 0 || m.removedNodes.length > 0)) reconcile();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      reconcile();

      const dispose = () => {
        observer.disconnect();
        for (const slider of sliders.values()) slider.dispose();
        sliders.clear();
      };
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });
});
