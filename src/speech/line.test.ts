import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lineToSpeak } from "./line";

describe("spoken line", () => {
  it("speaks the on-screen line and nothing else", () => {
    assert.equal(lineToSpeak("  That's iced Latte. Total $3.60. Say yes or tap Confirm.  "), "That's iced Latte. Total $3.60. Say yes or tap Confirm.");
  });

  it("speaks nothing when the screen has no line", () => {
    assert.equal(lineToSpeak("   "), "");
    assert.equal(lineToSpeak(null), "");
    assert.equal(lineToSpeak(undefined), "");
  });
});
