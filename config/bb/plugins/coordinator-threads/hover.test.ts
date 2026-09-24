// Run: node --experimental-strip-types hover.test.ts
import assert from "node:assert/strict";
import { hover, idle, inTriangle, type HoverEvent, type HoverState } from "./hover.ts";

const run = (...events: HoverEvent[]): HoverState => events.reduce(hover, idle);

// Opens instantly and switches rows without a close in between.
assert.equal(run({ type: "enter-row", key: "a" }).key, "a");
assert.equal(run({ type: "enter-row", key: "a" }, { type: "enter-row", key: "b" }).key, "b");

// Leaving schedules a close; the matching timer closes it.
const leaving = run({ type: "enter-row", key: "a" }, { type: "leave" });
assert.equal(leaving.key, "a");
assert.notEqual(leaving.closing, null);
assert.equal(hover(leaving, { type: "close-timer", gen: leaving.closing! }).key, null);

// Moving into the card (or back to a row) cancels the close; the old timer is ignored.
const inCard = hover(leaving, { type: "enter-card" });
assert.equal(inCard.closing, null);
assert.equal(hover(inCard, { type: "close-timer", gen: leaving.closing! }).key, "a");
const back = hover(leaving, { type: "enter-row", key: "a" });
assert.equal(hover(back, { type: "close-timer", gen: leaving.closing! }).key, "a");

// A second leave after re-entering needs its own timer; the first one can't close early.
const again = hover(inCard, { type: "leave" });
assert.equal(hover(again, { type: "close-timer", gen: leaving.closing! }).key, "a");
assert.equal(hover(again, { type: "close-timer", gen: again.closing! }).key, null);

// Escape closes at once; entering the card with nothing open does nothing.
assert.equal(run({ type: "enter-row", key: "a" }, { type: "escape" }).key, null);
assert.deepEqual(run({ type: "enter-card" }), idle);

// Safe triangle from the exit point (100,50) to the card edge (300,20)-(300,200).
const a = { x: 100, y: 50 }, top = { x: 300, y: 20 }, bottom = { x: 300, y: 200 };
assert.equal(inTriangle({ x: 200, y: 80 }, a, top, bottom), true); // heading down-right to the card
assert.equal(inTriangle({ x: 120, y: 150 }, a, top, bottom), false); // straight down the list
assert.equal(inTriangle({ x: 50, y: 60 }, a, top, bottom), false); // back left

console.log("hover tests passed");
