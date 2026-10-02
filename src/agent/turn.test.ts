import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { machineForUtterance, requestedMachine } from "./arrive";
import { answerWithRules } from "./rules";
import { applyHeard } from "./understand";
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

  it("takes a temperature for each drink in an and order", () => {
    const both = answerWithRules(coffee(), "I want a daily black and a mocha", 1);
    assert.equal(both.session.lines.length, 2);
    assert.equal(both.session.lines[0]?.productId, "coffee-05");
    assert.equal(both.session.lines[1]?.productId, "coffee-06");
    assert.equal(both.session.lines[0]?.temperature, undefined);
    assert.equal(both.session.lines[1]?.temperature, undefined);
    assert.match(both.say, /Daily Black/);
    assert.match(both.say, /Mocha/);
    assert.match(both.say, /Hot, iced, or room/);

    const first = answerWithRules(both.session, "hot", 2);
    assert.equal(first.session.lines[0]?.temperature, "hot");
    assert.equal(first.session.lines[1]?.temperature, undefined);
    assert.match(first.say, /Daily Black is hot/);
    assert.match(first.say, /Mocha still needs a temperature/);

    const second = answerWithRules(first.session, "iced", 3);
    assert.equal(second.session.lines[1]?.temperature, "iced");
    assert.equal(second.session.phase, "awaiting_confirmation");

    const together = answerWithRules(both.session, "both hot", 4);
    assert.equal(together.session.lines[0]?.temperature, "hot");
    assert.equal(together.session.lines[1]?.temperature, "hot");
    assert.equal(together.session.phase, "awaiting_confirmation");

    for (const phrase of ["hot for both", "cold for both", "iced for both", "room for both", "make them both hot", "for both, cold"]) {
      const shared = answerWithRules(both.session, phrase, 7);
      const expected = /cold|iced/.test(phrase) ? "iced" : /room/.test(phrase) ? "room" : "hot";
      assert.equal(shared.session.lines[0]?.temperature, expected, phrase);
      assert.equal(shared.session.lines[1]?.temperature, expected, phrase);
      assert.equal(shared.session.lines.length, 2, phrase);
      assert.equal(shared.session.phase, "awaiting_confirmation", phrase);
    }

    const split = answerWithRules(both.session, "hot and iced", 5);
    assert.equal(split.session.lines[0]?.temperature, "hot");
    assert.equal(split.session.lines[1]?.temperature, "iced");

    const three = answerWithRules(coffee(), "american , mocha and capacino", 8);
    assert.equal(three.session.lines.map((line) => line.productId).join(","), "coffee-01,coffee-06,coffee-02");
    assert.match(three.say, /Americano, Mocha and Cocoa Cappuccino/);

    const jammed = answerWithRules(coffee(), "americano mocha and cappuccino", 9);
    assert.equal(jammed.session.lines.map((line) => line.productId).join(","), "coffee-01,coffee-06,coffee-02");

    const four = answerWithRules(coffee(), "americano, mocha, cappuccino and latte", 10);
    assert.equal(four.session.lines.length, 4);

    const temps = answerWithRules(three.session, "hot, iced and room", 11);
    assert.equal(temps.session.lines[0]?.temperature, "hot");
    assert.equal(temps.session.lines[1]?.temperature, "iced");
    assert.equal(temps.session.lines[2]?.temperature, "room");

    const namedTemps = answerWithRules(both.session, "daily black iced and mocha hot", 6);
    assert.equal(namedTemps.session.lines.length, 2);
    assert.equal(namedTemps.session.lines.find((line) => line.productId === "coffee-05")?.temperature, "iced");
    assert.equal(namedTemps.session.lines.find((line) => line.productId === "coffee-06")?.temperature, "hot");
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

  it("asks for the drink that still needs a temperature after a snack is added", () => {
    const asked = answerWithRules(coffee(), "americano", 1);
    const turn = answerWithRules(asked.session, "potato chips", 2);
    assert.equal(turn.session.lines.length, 2);
    assert.match(turn.say, /Added Potato Chips/);
    assert.match(turn.say, /Americano still needs a temperature/);
    assert.doesNotMatch(turn.say, /Potato Chips is in the cart/);
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

    const again = answerWithRules(asked.session, "latte", 5);
    assert.equal(again.session.lines.length, 1);
    assert.equal(again.session.lines[0]?.quantity, 1);
    assert.equal(again.session.lines[0]?.temperature, undefined);
    assert.match(again.say, /Hot, iced, or room/);

    const korean = applyHeard(
      asked.session,
      { action: "add", lines: [{ productId: "coffee-04", temperature: null }], choices: [], menu: null },
      6,
    );
    assert.equal(korean?.session.lines.length, 1);
    assert.equal(korean?.session.lines[0]?.quantity, 1);
    assert.match(korean?.say ?? "", /still needs a temperature/);
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
      ui: null,
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

  it("adds an iced americano beside a hot one instead of bumping hot quantity", () => {
    const drafted = answerWithRules(coffee(), "hot americano", 1);
    assert.equal(drafted.session.lines.length, 1);
    assert.equal(drafted.session.lines[0]?.productId, "coffee-01");
    assert.equal(drafted.session.lines[0]?.temperature, "hot");
    assert.equal(drafted.session.lines[0]?.quantity, 1);

    for (const phrase of ["add another iced americano", "one more cold americano"]) {
      const turn = answerWithRules(drafted.session, phrase, 2);
      assert.equal(turn.session.lines.length, 2, phrase);
      const hot = turn.session.lines.find((line) => line.temperature === "hot");
      const iced = turn.session.lines.find((line) => line.temperature === "iced");
      assert.equal(hot?.productId, "coffee-01", phrase);
      assert.equal(hot?.quantity, 1, phrase);
      assert.equal(iced?.productId, "coffee-01", phrase);
      assert.equal(iced?.quantity, 1, phrase);
      assert.equal(turn.session.phase, "awaiting_confirmation", phrase);
      assert.ok(turn.readBack, phrase);
    }
  });

  it("removes a named drink with or without the, and with iced or hot in the name", () => {
    const drafted = answerWithRules(coffee(), "iced spiced chai and iced latte", 1);
    assert.equal(drafted.session.lines.length, 2);

    for (const phrase of [
      "Remove Spiced Iced Chai.",
      "remove the spiced iced chai",
      "remove spiced chai",
      "delete the spiced iced chai",
      "take off the spiced iced chai",
      "take the spiced iced chai off",
      "get rid of the spiced iced chai",
    ]) {
      const turn = answerWithRules(drafted.session, phrase, 2);
      assert.equal(turn.session.lines.length, 1, phrase);
      assert.equal(turn.session.lines[0]?.productId, "coffee-04", phrase);
      assert.equal(turn.session.phase, "awaiting_confirmation", phrase);
      assert.match(turn.say, /Removed Spiced Chai/, phrase);
      assert.doesNotMatch(turn.say, /What do you want to change/, phrase);
      assert.doesNotMatch(turn.say, /What else would you like/, phrase);
    }

    // Spoken "iced" in the name still removes the only Spiced Chai when that line is hot.
    const hot = answerWithRules(coffee(), "hot spiced chai and potato chips", 1);
    const rem = answerWithRules(hot.session, "remove spiced iced chai", 2);
    assert.equal(rem.session.lines.length, 1);
    assert.equal(rem.session.lines[0]?.productId, "snacks-19");
    assert.match(rem.say, /Removed Spiced Chai/);
    assert.doesNotMatch(rem.say, /What do you want to change/);
  });
});
