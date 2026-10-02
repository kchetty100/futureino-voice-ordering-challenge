import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlaybackEcho, lineToSpeak } from "./line";

describe("spoken line", () => {
  it("speaks the on-screen line and nothing else", () => {
    assert.equal(lineToSpeak("  That's iced Latte. Total $3.60. Say yes or tap Confirm.  "), "That's iced Latte. Total $3.60. Say yes or tap Confirm.");
  });

  it("drops a clip of the line just spoken and keeps a short yes", () => {
    const spoken = "That's iced Latte. Total $3.60. Would you like to add anything else, or say yes to confirm the order?";
    assert.equal(isPlaybackEcho(spoken, spoken), true);
    assert.equal(isPlaybackEcho("yes", spoken), false);
    assert.equal(isPlaybackEcho("two iced lattes", spoken), false);
  });

  it("speaks nothing when the screen has no line", () => {
    assert.equal(lineToSpeak("   "), "");
    assert.equal(lineToSpeak(null), "");
    assert.equal(lineToSpeak(undefined), "");
  });
});
