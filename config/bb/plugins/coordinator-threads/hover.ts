// Hover-card state for task rows: opens instantly on hover or focus, closes
// after a short delay once the pointer has left both the row and the card.
// Pure so hover.test.ts can drive it; the component owns the timer.

export const CLOSE_DELAY_MS = 140;

/** `gen` identifies the pending close so a stale timer can't close a re-opened card. */
export interface HoverState {
  key: string | null;
  closing: number | null;
  gen: number;
}

export type HoverEvent =
  | { type: "enter-row"; key: string }
  | { type: "enter-card" }
  | { type: "leave" }
  | { type: "close-timer"; gen: number }
  | { type: "escape" };

export const idle: HoverState = { key: null, closing: null, gen: 0 };

export function hover(state: HoverState, event: HoverEvent): HoverState {
  switch (event.type) {
    case "enter-row":
      return { key: event.key, closing: null, gen: state.gen };
    case "enter-card":
      return state.key === null ? state : { ...state, closing: null };
    case "leave":
      if (state.key === null || state.closing !== null) return state;
      return { ...state, closing: state.gen + 1, gen: state.gen + 1 };
    case "close-timer":
      return state.closing === event.gen ? { key: null, closing: null, gen: state.gen } : state;
    case "escape":
      return { key: null, closing: null, gen: state.gen };
  }
}

type Point = { x: number; y: number };
/**
 * Safe triangle: whether `p` lies in the triangle from where the pointer left
 * the row (`a`) to the card's near edge (`b` top, `c` bottom). While it does,
 * other rows the pointer crosses on its way to the card don't steal it.
 */
export function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const side = (u: Point, v: Point, w: Point) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
