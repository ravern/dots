// Pure helpers shared by app.ts and app.test.ts.

/** Nearest stop index for a pointer at `x` over a track [left, left+width]. */
export function indexAtPosition(x: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (x - left) / width));
  return Math.round(ratio * (count - 1));
}

/** Stop position as a percentage along the track. */
export function percentForIndex(index: number, count: number): number {
  return count <= 1 ? 0 : (index / (count - 1)) * 100;
}

/** Index after a key press, or null when the key isn't a slider key. */
export function indexForKey(key: string, index: number, count: number): number | null {
  const last = Math.max(0, count - 1);
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(last, index + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
