import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerWithRules } from "./rules";
import { runTool } from "./tools";
import { createSession } from "../order/engine";

function coffee() {
  return createSession({ id: "c", machineId: "coffee", now: 0 });
}

function snacks() {
  return createSession({ id: "s", machineId: "snacks", now: 0 });
}

describe("text agent", () => {
  it("drafts an iced latte and confirms only on a clear yes", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    assert.equal(drafted.session.lines.length, 1);
    assert.equal(drafted.session.lines[0]?.productId, "coffee-04");
    assert.equal(drafted.session.lines[0]?.temperature, "iced");
    assert.equal(drafted.session.phase, "awaiting_confirmation");
    assert.match(drafted.say, /iced Latte/);
    assert.match(drafted.say, /\$3\.60/);

    const early = answerWithRules(coffee(), "yes", 1);
    assert.equal(early.session.phase, "browsing");
    assert.equal(early.session.lines.length, 0);

    const paid = answerWithRules(drafted.session, "yes", 2);
    assert.equal(paid.session.phase, "ready_to_pay");
    assert.equal(paid.session.confirmedBy, "voice_yes");
  });

  it("does not treat a qualified yes as confirmation", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const changed = answerWithRules(drafted.session, "yes but make it hot", 2);
    assert.notEqual(changed.session.phase, "ready_to_pay");
    assert.equal(changed.session.lines.some((line) => line.temperature === "iced"), true);
  });

  it("refuses an item the machine does not carry", () => {
    const turn = answerWithRules(coffee(), "a burger", 1);
    assert.equal(turn.session.lines.length, 0);
    assert.equal(turn.say, "This machine doesn't carry that.");
    assert.equal(turn.say.includes("burger"), false);
  });

  it("does not add a snack to the coffee machine", () => {
    const turn = answerWithRules(coffee(), "potato chips", 1);
    assert.equal(turn.session.lines.length, 0);
  });

  it("adds a snack without a temperature and lists chips instead of guessing", () => {
    const chips = answerWithRules(snacks(), "potato chips", 1);
    assert.equal(chips.session.lines.length, 1);
    assert.equal(chips.session.lines[0]?.productId, "snacks-19");
    assert.equal(chips.session.phase, "awaiting_confirmation");

    const vague = answerWithRules(snacks(), "chips", 1);
    assert.equal(vague.session.lines.length, 0);
    assert.match(vague.say, /Potato Chips/);
    assert.match(vague.say, /I can offer/);
  });

  it("asks for a temperature, then accepts one word", () => {
    const asked = answerWithRules(coffee(), "latte", 1);
    assert.equal(asked.session.phase, "drafting");
    assert.equal(asked.session.lines[0]?.temperature, undefined);
    assert.match(asked.say, /Hot, iced, or room/);

    const iced = answerWithRules(asked.session, "iced", 2);
    assert.equal(iced.session.lines[0]?.temperature, "iced");
    assert.equal(iced.session.phase, "awaiting_confirmation");
  });

  it("says allergens are unknown and does not change the cart", () => {
    const turn = answerWithRules(coffee(), "does it contain peanuts", 1);
    assert.equal(turn.session.lines.length, 0);
    assert.match(turn.say, /don't have allergen information/);
  });

  it("has no confirm tool", () => {
    const effect = runTool(coffee(), "confirm", { cartVersion: 1 }, 1);
    assert.equal(effect.ok, false);
    assert.equal(effect.session.phase, "browsing");
    assert.equal(effect.session.lines.length, 0);
  });

  it("rejects a made-up product id", () => {
    const effect = runTool(coffee(), "add_to_cart", { productId: "burger" }, 1);
    assert.equal(effect.ok, false);
    assert.equal(effect.session.lines.length, 0);
    assert.equal(effect.say, "That item is not on this machine.");
  });
});
