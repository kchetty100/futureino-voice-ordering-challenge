import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLeaveClock, leaveSecondsLeft } from "./leave";
import { nextPresence, type Presence } from "./presence";
import { utteranceReady } from "./voice";

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

describe("a short temperature word", () => {
  it("sends hot once it has been loud briefly and then quiet", () => {
    assert.equal(utteranceReady(100, 500, 600), "wait");
    assert.equal(utteranceReady(140, 449, 600), "wait");
    assert.equal(utteranceReady(140, 450, 600), "send");
    assert.equal(utteranceReady(0, 0, 6_000), "drop");
    assert.equal(utteranceReady(140, 0, 12_000), "send");
  });
});

describe("leaving when the camera sees nobody", () => {
  it("waits 10 seconds, then counts down for one minute", () => {
    assert.equal(leaveSecondsLeft(9_999), null);
    assert.equal(leaveSecondsLeft(10_000), 60);
    assert.equal(leaveSecondsLeft(10_001), 60);
    assert.equal(leaveSecondsLeft(69_000), 1);
    assert.equal(leaveSecondsLeft(70_000), 0);
    assert.equal(formatLeaveClock(60), "1:00");
    assert.equal(formatLeaveClock(9), "0:09");
  });
});
