// While Provider Plugins is open, bb's sidebar should look like its Plugins sidebar: our
// navigation rows only. bb renders Plugins as a separate shell that plugins can't select, so we
// hide the rest of the app sidebar (thread list, footer) instead, and put it back on leave.

/** The sidebar our navigation sits in: desktop, or the mobile drawer's body. */
export const SIDEBAR_ROOT = '[data-sidebar="sidebar"], [data-testid="app-sidebar-body"]';
/** What bb's Plugins shell doesn't have: the thread list's scroll area and the footer. */
export const SIDEBAR_REST = ['[data-sidebar="content"]', '[data-sidebar="footer"]'];

/** Whether bb's sidebar says our page is the one showing. */
export const isOurPage = (activeItemId: string | null, pluginId: string, panelId: string) => activeItemId === `${pluginId}/${panelId}`;

/**
 * The parts of the sidebar holding `nav` to hide: for each region, its outermost matches that
 * neither hold nor sit inside our rows. Null (hide nothing) unless every region is found, so a
 * changed bb layout leaves the sidebar whole rather than hiding the wrong thing.
 */
export function sidebarRest(nav: Element): HTMLElement[] | null {
  const root = nav.closest(SIDEBAR_ROOT);
  if (root === null) return null;
  const found = SIDEBAR_REST.map((selector) =>
    [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.contains(nav) && !nav.contains(el) && el.parentElement?.closest(selector) == null),
  );
  return found.every((f) => f.length > 0) ? found.flat() : null;
}

/** Hides elements and puts back exactly the display each had. */
export function hider() {
  const saved = new Map<HTMLElement, string>();
  return {
    hide(elements: Iterable<HTMLElement>) {
      for (const el of elements) {
        if (saved.has(el)) continue;
        saved.set(el, el.style.display);
        el.style.display = "none";
      }
    },
    restore() {
      // Leave anything bb changed since alone.
      for (const [el, display] of saved) if (el.style.display === "none") el.style.display = display;
      saved.clear();
    },
  };
}
