// Run: node --experimental-strip-types app.test.ts
import assert from "node:assert/strict";
import { indexAtPosition, indexForKey, percentForIndex } from "./slider-math.ts";

assert.equal(indexAtPosition(0, 0, 100, 5), 0);
assert.equal(indexAtPosition(100, 0, 100, 5), 4);
assert.equal(indexAtPosition(49, 0, 100, 5), 2);
assert.equal(indexAtPosition(-50, 0, 100, 5), 0); // clamped
assert.equal(indexAtPosition(500, 0, 100, 5), 4);
assert.equal(indexAtPosition(10, 0, 100, 1), 0);
assert.equal(percentForIndex(0, 4), 0);
assert.equal(percentForIndex(3, 4), 100);
assert.equal(percentForIndex(0, 1), 0);
assert.equal(indexForKey("ArrowRight", 3, 4), 3); // stays at max
assert.equal(indexForKey("ArrowLeft", 0, 4), 0);
assert.equal(indexForKey("ArrowRight", 1, 4), 2);
assert.equal(indexForKey("End", 0, 4), 3);
assert.equal(indexForKey("Home", 3, 4), 0);
assert.equal(indexForKey("Enter", 1, 4), null);
console.log("ok");
