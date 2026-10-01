import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { machineForUtterance, requestedMachine } from "./arrive";
import { answerWithRules } from "./rules";
import { chooseTurn } from "./turn";
import { changesOrder, isClearYes, runTool } from "./tools";
import { createSession } from "../order/engine";

function coffee() {
  return createSession({ id: "c", machineId: "coffee", now: 0 });
}

function snacks() {
  return createSession({ id: "s", machineId: "snacks", now: 0 });
}

describe("text agent", () => {
  it("adds a hot americano named in the same sentence", () => {
    for (const phrase of ["I want the americano hot", "I want the maricano hot", "I want the American hot"]) {
      const turn = answerWithRules(coffee(), phrase, 1);
      assert.equal(turn.session.lines.length, 1, phrase);
      assert.equal(turn.session.lines[0]?.productId, "coffee-01", phrase);
      assert.equal(turn.session.lines[0]?.temperature, "hot", phrase);
      assert.equal(turn.session.phase, "awaiting_confirmation", phrase);
      assert.match(turn.say, /hot Americano/);
      assert.doesNotMatch(turn.say, /doesn't carry/);
    }
  });

  it("adds an americano named inside a sentence", () => {
    const turn = answerWithRules(coffee(), "I want an americano", 1);
    assert.equal(turn.session.lines.length, 1);
    assert.equal(turn.session.lines[0]?.productId, "coffee-01");
    assert.equal(turn.session.lines[0]?.temperature, undefined);
    assert.match(turn.say, /Americano/);
    assert.match(turn.say, /Hot, iced, or room/);
    assert.doesNotMatch(turn.say, /I can offer/);
  });

  it("drafts an iced latte and confirms only on a clear yes", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    assert.equal(drafted.session.lines.length, 1);
    assert.equal(drafted.session.lines[0]?.productId, "coffee-04");
    assert.equal(drafted.session.lines[0]?.temperature, "iced");
    assert.equal(drafted.session.phase, "awaiting_confirmation");
    assert.match(drafted.say, /iced Latte/);
    assert.match(drafted.say, /\$3\.60/);
    assert.match(drafted.say, /add anything else/i);
    assert.match(drafted.say, /say yes to confirm/i);

    const more = answerWithRules(drafted.session, "something else", 2);
    assert.equal(more.session.phase, "drafting");
    assert.equal(more.session.lines.length, 1);
    assert.equal(more.say, "What else would you like?");

    const early = answerWithRules(coffee(), "yes", 1);
    assert.equal(early.session.phase, "browsing");
    assert.equal(early.session.lines.length, 0);

    const paid = answerWithRules(drafted.session, "yes", 2);
    assert.equal(paid.session.phase, "ready_to_pay");
    assert.equal(paid.session.confirmedBy, "voice_yes");
  });

  it("confirms a spoken yes with punctuation or polite filler", () => {
    const drafted = answerWithRules(coffee(), "I want the americano hot", 1);
    for (const phrase of ["Yes?", "Yes,", "Yes, please.", "yes that's right", "uh yes", "proceed", "confrirm", "sounds good", "I'll take it"]) {
      const paid = answerWithRules(drafted.session, phrase, 2);
      assert.equal(paid.session.phase, "ready_to_pay", phrase);
      assert.equal(paid.session.confirmedBy, "voice_yes", phrase);
      assert.doesNotMatch(paid.say, /doesn't carry/);
    }
  });

  it("does not treat a change as a confirmation word", () => {
    assert.equal(isClearYes("proceed"), true);
    assert.equal(isClearYes("yes but make it hot"), false);
    assert.equal(changesOrder("yes but make it hot"), true);
    assert.equal(changesOrder("proceed"), false);
    assert.equal(changesOrder("let's ring it up"), false);
  });

  it("confirms when they do not want anything else", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    for (const phrase of ["no", "no thanks", "nothing else", "that's it", "I'm good", "no more"]) {
      const paid = answerWithRules(drafted.session, phrase, 2);
      assert.equal(paid.session.phase, "ready_to_pay", phrase);
      assert.equal(paid.session.lines[0]?.temperature, "iced", phrase);
      assert.doesNotMatch(paid.say, /doesn't carry/);
    }
    const changed = answerWithRules(drafted.session, "no, make it hot", 3);
    assert.notEqual(changed.session.phase, "ready_to_pay");
    const missing = answerWithRules(drafted.session, "a burger", 4);
    assert.equal(missing.say, "This machine doesn't carry that.");
    const vague = answerWithRules(drafted.session, "um", 5);
    assert.equal(vague.say, "Add another item, or say yes to confirm.");
  });

  it("does not treat a qualified yes as confirmation", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const changed = answerWithRules(drafted.session, "yes but make it hot", 2);
    assert.notEqual(changed.session.phase, "ready_to_pay");
    assert.equal(changed.session.lines[0]?.temperature, "hot");
    assert.ok(changed.readBack);
  });

  it("refuses an item the machine does not carry", () => {
    const turn = answerWithRules(coffee(), "a burger", 1);
    assert.equal(turn.session.lines.length, 0);
    assert.equal(turn.say, "This machine doesn't carry that.");
    assert.equal(turn.say.includes("burger"), false);
  });

  it("opens Snacks Bot when a coffee order asks what snacks are there", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const turn = answerWithRules(drafted.session, "what snacks do you have", 2);
    assert.equal(turn.switchTo, "snacks");
    assert.equal(turn.session.machineId, "coffee");
    assert.equal(turn.session.lines.length, 1);
    assert.equal(turn.session.lines[0]?.productId, "coffee-04");
    assert.equal(turn.say, "Please view the items below.");
    assert.deepEqual(turn.spotlightIds, []);
    const added = answerWithRules(drafted.session, "I would like to add a snack", 3);
    assert.equal(added.switchTo, "snacks");
    assert.equal(added.session.lines.length, 1);
    assert.equal(added.session.lines[0]?.productId, "coffee-04");
    assert.equal(added.say, "Please view the items below.");
    assert.doesNotMatch(added.say, /doesn't carry/);
    assert.equal(requestedMachine("I would like to add a snack"), "snacks");
    assert.equal(requestedMachine("what snacks do you have"), "snacks");
    assert.equal(requestedMachine("What's next do you have?"), "snacks");
    const coffeeAsk = answerWithRules(coffee(), "I want a coffee", 4);
    assert.equal(coffeeAsk.session.lines.length, 0);
    assert.equal(coffeeAsk.say, "Please view the items below.");
    assert.equal(coffeeAsk.switchTo, "coffee");
    assert.deepEqual(coffeeAsk.spotlightIds, []);
    assert.equal(machineForUtterance("iced latte"), "coffee");
    assert.equal(machineForUtterance("potato chips"), "snacks");
    assert.equal(machineForUtterance("hello"), null);
  });

  it("adds each item in an and sentence to the same cart", () => {
    const both = answerWithRules(coffee(), "iced latte and potato chips", 1);
    assert.equal(both.session.lines.length, 2);
    assert.equal(both.session.lines[0]?.productId, "coffee-04");
    assert.equal(both.session.lines[0]?.temperature, "iced");
    assert.equal(both.session.lines[1]?.productId, "snacks-19");
    assert.equal(both.session.phase, "awaiting_confirmation");
    assert.match(both.say, /Latte/);
    assert.match(both.say, /Potato Chips/);

    const drinks = answerWithRules(coffee(), "hot americano and an iced latte", 2);
    assert.equal(drinks.session.lines[0]?.productId, "coffee-01");
    assert.equal(drinks.session.lines[0]?.temperature, "hot");
    assert.equal(drinks.session.lines[1]?.productId, "coffee-04");
    assert.equal(drinks.session.lines[1]?.temperature, "iced");

    const named = answerWithRules(snacks(), "cookies and cream bar", 3);
    assert.equal(named.session.lines.length, 1);
    assert.equal(named.session.lines[0]?.productId, "snacks-21");
  });

  it("updates the cart from the review and stays there", () => {
    const drafted = answerWithRules(coffee(), "iced latte and potato chips", 1);
    assert.equal(drafted.session.phase, "awaiting_confirmation");
    assert.ok(drafted.readBack);

    const chips = answerWithRules(snacks(), "potato chips", 1);
    const more = answerWithRules(chips.session, "add one more item", 2);
    assert.equal(more.session.phase, "awaiting_confirmation");
    assert.equal(more.session.lines[0]?.quantity, 2);
    assert.equal(more.switchTo, null);
    assert.ok(more.readBack);
    assert.match(more.say, /one more/);
    assert.match(more.say, /Potato Chips/);

    const which = answerWithRules(drafted.session, "add one more", 2);
    assert.equal(which.session.lines.length, 2);
    assert.equal(which.session.phase, "awaiting_confirmation");
    assert.match(which.say, /Which item/);
    assert.ok(which.readBack);

    const removed = answerWithRules(drafted.session, "remove the latte", 3);
    assert.equal(removed.session.phase, "awaiting_confirmation");
    assert.equal(removed.session.lines.length, 1);
    assert.equal(removed.session.lines[0]?.productId, "snacks-19");
    assert.equal(removed.switchTo, null);
    assert.ok(removed.readBack);
    assert.match(removed.say, /Removed Latte/);

    const missing = answerWithRules(removed.session, "remove the burger", 4);
    assert.equal(missing.session.lines.length, 1);
    assert.equal(missing.session.phase, "awaiting_confirmation");
    assert.match(missing.say, /isn't in this order/);

    const hotter = answerWithRules(drafted.session, "make the latte hot", 5);
    assert.equal(hotter.session.lines.find((line) => line.productId === "coffee-04")?.temperature, "hot");
    assert.equal(hotter.session.phase, "awaiting_confirmation");
    assert.ok(hotter.readBack);
  });

  it("adds a snack to the same cart as the coffee", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const turn = answerWithRules(drafted.session, "potato chips", 2);
    assert.equal(turn.session.lines.length, 2);
    assert.equal(turn.session.lines[0]?.productId, "coffee-04");
    assert.equal(turn.session.lines[1]?.productId, "snacks-19");
    assert.equal(turn.session.phase, "awaiting_confirmation");
    assert.match(turn.say, /Latte/);
    assert.match(turn.say, /Potato Chips/);
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

    const hot = answerWithRules(asked.session, "hot please", 3);
    assert.equal(hot.session.lines[0]?.temperature, "hot");
    assert.equal(hot.session.phase, "awaiting_confirmation");

    const ice = answerWithRules(asked.session, "make it ice", 4);
    assert.equal(ice.session.lines[0]?.temperature, "iced");
    assert.equal(ice.session.phase, "awaiting_confirmation");
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

  it("drops a model draft that adds an item the rules left out", () => {
    const before = snacks();
    const ruled = answerWithRules(before, "chips", 1);
    assert.equal(ruled.session.lines.length, 0);
    const added = runTool(before, "add_to_cart", { productId: "snacks-19" }, 1);
    const chosen = chooseTurn(before, ruled, {
      session: added.session,
      say: added.say,
      spotlightIds: added.spotlightIds,
      readBack: added.readBack,
      switchTo: null,
    });
    assert.equal(chosen.session.lines.length, 0);
    assert.match(chosen.say, /Potato Chips/);
  });

  it("rejects a made-up product id", () => {
    const effect = runTool(coffee(), "add_to_cart", { productId: "burger" }, 1);
    assert.equal(effect.ok, false);
    assert.equal(effect.session.lines.length, 0);
    assert.equal(effect.say, "That item is not on this machine.");
  });
});
