import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextPresence, type Presence } from "./presence";

const empty: Presence = { present: false, faces: 0, misses: 0 };

describe("customer in front of the camera", () => {
  it("waits for a second face before the mic should open", () => {
    const once = nextPresence(empty, true);
    assert.equal(once.present, false);
    const held = nextPresence(once, true);
    assert.equal(held.present, true);
  });

  it("keeps the mic open through a short look-away", () => {
    const held = nextPresence(nextPresence(empty, true), true);
    let state = held;
    for (let miss = 0; miss < 7; miss += 1) state = nextPresence(state, false);
    assert.equal(state.present, true);
    assert.equal(nextPresence(state, false).present, false);
  });
});
