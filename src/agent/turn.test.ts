import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { machineForUtterance, requestedMachine } from "./arrive";
import { answerWithRules } from "./rules";
import { applyHeard } from "./understand";
import { chooseTurn, confirmationDecision, heardForSpeech } from "./turn";
import { changesOrder, isClearYes, runTool } from "./tools";
import { createSession } from "../order/engine";
import { getItem } from "../catalog/index";

function suit(ids: readonly string[], temperature: "hot" | "iced"): boolean {
  return ids.length > 0 && ids.every((id) => getItem(id)?.suits?.includes(temperature));
}

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
      assert.match(turn.say, /Americano · hot/);
      assert.doesNotMatch(turn.say, /doesn['’]t carry/);
    }
  });

  it("adds an americano named inside a sentence", () => {
    const turn = answerWithRules(coffee(), "I want an americano", 1);
    assert.equal(turn.session.lines.length, 1);
    assert.equal(turn.session.lines[0]?.productId, "coffee-01");
    assert.equal(turn.session.lines[0]?.temperature, undefined);
    assert.match(turn.say, /Americano/);
    assert.match(turn.say, /hot, iced, or room/i);
    assert.doesNotMatch(turn.say, /I can offer/);
  });

  it("drafts an iced latte and confirms only on a clear yes", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    assert.equal(drafted.session.lines.length, 1);
    assert.equal(drafted.session.lines[0]?.productId, "coffee-04");
    assert.equal(drafted.session.lines[0]?.temperature, "iced");
    assert.equal(drafted.session.phase, "awaiting_confirmation");
    assert.match(drafted.say, /Latte · iced/);
    assert.match(drafted.say, /\$3\.60/);
    assert.match(drafted.say, /Anything else/i);
    assert.match(drafted.say, /tap Confirm order/);

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
    for (const phrase of ["Yes?", "Yes,", "Yes, please.", "yes that's right", "uh yes", "proceed", "confrirm", "sounds good", "I'll take it", "yeah", "yup", "sure", "ok", "okay", "looks good", "confirm"]) {
      const paid = answerWithRules(drafted.session, phrase, 2);
      assert.equal(paid.session.phase, "ready_to_pay", phrase);
      assert.equal(paid.session.confirmedBy, "voice_yes", phrase);
      assert.doesNotMatch(paid.say, /doesn['’]t carry/);
    }
  });

  it("does not treat a change as a confirmation word", () => {
    assert.equal(isClearYes("proceed"), true);
    assert.equal(isClearYes("couldnt farm"), false);
    assert.equal(isClearYes("couldnt farm", true), true);
    assert.equal(isClearYes("couldn't farm", true), true);
    assert.equal(isClearYes("come firm", true), true);
    assert.equal(isClearYes("chicken for me", true), false);
    assert.equal(isClearYes("cappuccino from", true), false);
    assert.equal(isClearYes("couldnt farm make it hot", true), false);
    assert.equal(isClearYes("yes but make it hot"), false);
    assert.equal(isClearYes("ok make it hot"), false);
    assert.equal(isClearYes("looks good"), true);
    assert.equal(changesOrder("yes but make it hot"), true);
    assert.equal(changesOrder("ok make it hot"), true);
    assert.equal(changesOrder("proceed"), false);
    assert.equal(changesOrder("let's ring it up"), false);
  });

  it("confirms when they do not want anything else", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    for (const phrase of ["no", "no thanks", "nothing else", "that's it", "I'm good", "no more", "all set", "I'm done", "I am done", "done", "checkout", "check out"]) {
      const paid = answerWithRules(drafted.session, phrase, 2);
      assert.equal(paid.session.phase, "ready_to_pay", phrase);
      assert.equal(paid.session.lines[0]?.temperature, "iced", phrase);
      assert.doesNotMatch(paid.say, /doesn['’]t carry/);
    }
    const changed = answerWithRules(drafted.session, "no, make it hot", 3);
    assert.notEqual(changed.session.phase, "ready_to_pay");
    const missing = answerWithRules(drafted.session, "a burger", 4);
    assert.equal(missing.say, "This machine doesn’t carry that. Pick from the menu, or say what you’d like.");
    const vague = answerWithRules(drafted.session, "um", 5);
    assert.equal(vague.say, "Anything else, or say confirm?");
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
    assert.equal(turn.say, "This machine doesn’t carry that. Pick from the menu, or say what you’d like.");
    assert.equal(turn.say.includes("burger"), false);
  });

  it("stays on the bound machine when speech asks for the other catalog", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const turn = answerWithRules(drafted.session, "what snacks do you have", 2);
    assert.equal(turn.switchTo, null);
    assert.equal(turn.session.machineId, "coffee");
    assert.equal(turn.session.lines.length, 1);
    assert.equal(turn.session.lines[0]?.productId, "coffee-04");
    assert.equal(turn.say, "That item is not on this machine.");
    assert.deepEqual(turn.spotlightIds, []);
    const added = answerWithRules(drafted.session, "I would like to add a snack", 3);
    assert.equal(added.switchTo, null);
    assert.equal(added.session.lines.length, 1);
    assert.equal(added.session.lines[0]?.productId, "coffee-04");
    assert.equal(added.say, "That item is not on this machine.");
    assert.equal(requestedMachine("I would like to add a snack"), "snacks");
    assert.equal(requestedMachine("what snacks do you have"), "snacks");
    assert.equal(requestedMachine("What's next do you have?"), "snacks");
    const coffeeAsk = answerWithRules(coffee(), "I want a coffee", 4);
    assert.equal(coffeeAsk.session.lines.length, 0);
    assert.equal(coffeeAsk.say, "Hi! I’m Boost. Coffee, tea, matcha or juice, hot, iced or room temp. What can I make you?");
    assert.equal(coffeeAsk.switchTo, null);
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

    const listed = answerWithRules(snacks(), "cookies and cream and potato chips and pretzels", 4);
    assert.deepEqual(
      listed.session.lines.map((line) => line.productId),
      ["snacks-21", "snacks-19", "snacks-22"],
    );
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
    assert.match(both.say, /hot, iced, or room/i);

    const first = answerWithRules(both.session, "hot", 2);
    assert.equal(first.session.lines[0]?.temperature, "hot");
    assert.equal(first.session.lines[1]?.temperature, undefined);
    assert.match(first.say, /Daily Black is hot/);
    assert.match(first.say, /Mocha needs hot, iced, or room/i);

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

    const counted = answerWithRules(coffee(), "give me 1 american , 2 mocas and 1 latte all hot", 12);
    assert.deepEqual(
      counted.session.lines.map((line) => [line.productId, line.quantity, line.temperature]),
      [
        ["coffee-01", 1, "hot"],
        ["coffee-06", 2, "hot"],
        ["coffee-04", 1, "hot"],
      ],
    );
    assert.equal(counted.session.phase, "awaiting_confirmation");

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
    assert.match(turn.say, /Americano needs hot, iced, or room/i);
    assert.doesNotMatch(turn.say, /Potato Chips is in the cart/);
  });

  it("adds a snack to the same cart as the coffee", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const turn = answerWithRules(drafted.session, "potato chips", 2);
    assert.equal(turn.session.lines.length, 2);
    assert.equal(turn.session.lines[0]?.productId, "coffee-04");
    assert.equal(turn.session.lines[1]?.productId, "snacks-19");
    assert.equal(turn.session.phase, "awaiting_confirmation");
    assert.match(turn.say, /Total \$5\.60/);
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
    assert.match(asked.say, /hot, iced, or room/i);

    const iced = answerWithRules(asked.session, "iced", 2);
    assert.equal(iced.session.lines[0]?.temperature, "iced");
    assert.equal(iced.session.phase, "awaiting_confirmation");

    const hot = answerWithRules(asked.session, "hot please", 3);
    assert.equal(hot.session.lines[0]?.temperature, "hot");
    assert.equal(hot.session.phase, "awaiting_confirmation");

    const ice = answerWithRules(asked.session, "make it ice", 4);
    assert.equal(ice.session.lines[0]?.temperature, "iced");
    assert.equal(ice.session.phase, "awaiting_confirmation");

    const hod = answerWithRules(asked.session, "hod", 7);
    assert.equal(hod.session.lines[0]?.temperature, "hot");
    const cod = answerWithRules(asked.session, "cod", 8);
    assert.equal(cod.session.lines[0]?.temperature, "iced");
    const hat = answerWithRules(asked.session, "hat", 9);
    assert.equal(hat.session.lines[0]?.temperature, undefined);
    const could = answerWithRules(asked.session, "could", 10);
    assert.equal(could.session.lines[0]?.temperature, undefined);
    const named = answerWithRules(coffee(), "hod latte", 11);
    assert.equal(named.session.lines[0]?.productId, "coffee-04");
    assert.equal(named.session.lines[0]?.temperature, "hot");

    const again = answerWithRules(asked.session, "latte", 5);
    assert.equal(again.session.lines.length, 1);
    assert.equal(again.session.lines[0]?.quantity, 1);
    assert.equal(again.session.lines[0]?.temperature, undefined);
    assert.match(again.say, /hot, iced, or room/i);

    const korean = applyHeard(
      asked.session,
      { action: "add", lines: [{ productId: "coffee-04", temperature: null }], choices: [], menu: null },
      6,
    );
    assert.equal(korean?.session.lines.length, 1);
    assert.equal(korean?.session.lines[0]?.quantity, 1);
    assert.match(korean?.say ?? "", /needs hot, iced, or room/i);
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

  it("clears the cart for a generic wipe and removes only the named product", () => {
    const drafted = answerWithRules(coffee(), "iced latte and potato chips", 1);
    assert.equal(drafted.session.lines.length, 2);

    const lattes = answerWithRules(drafted.session, "remove all the lattes", 2);
    assert.equal(lattes.session.lines.length, 1);
    assert.equal(lattes.session.lines[0]?.productId, "snacks-19");
    assert.match(lattes.say, /Removed Latte/);

    const one = answerWithRules(drafted.session, "remove the latte", 3);
    assert.equal(one.session.lines.length, 1);
    assert.equal(one.session.lines[0]?.productId, "snacks-19");

    for (const phrase of ["remove everything from the cart", "delete everything", "start over", "scratch that", "get rid of all of it"]) {
      const wiped = answerWithRules(drafted.session, phrase, 4);
      assert.equal(wiped.session.lines.length, 0, phrase);
      assert.equal(wiped.session.phase, "browsing", phrase);
      assert.equal(wiped.say, "Cart cleared.", phrase);
      assert.notEqual(wiped.session.phase, "ready_to_pay", phrase);
    }
  });

  it("treats a correction on review as a change, not a yes", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    for (const phrase of ["that's wrong", "wrong item", "hold on", "that's not right"]) {
      const turned = answerWithRules(drafted.session, phrase, 2);
      assert.notEqual(turned.session.phase, "ready_to_pay", phrase);
      assert.equal(turned.session.lines.length, 1, phrase);
      assert.match(turned.say, /What do you want to change/, phrase);
    }
    const paid = answerWithRules(drafted.session, "yes", 3);
    assert.equal(paid.session.phase, "ready_to_pay");
  });

  it("never accepts a model decline", () => {
    assert.equal(confirmationDecision("decline", "that's wrong"), "decline");
    assert.equal(confirmationDecision("decline", "wait"), "decline");
    assert.equal(confirmationDecision("confirm", "sounds good"), "accept");
    assert.equal(confirmationDecision("confirm", "yes but make it hot"), null);
    assert.equal(confirmationDecision("other", "a mocha"), null);
  });

  it("hears a spoken count as the quantity", () => {
    const lattes = answerWithRules(coffee(), "two iced lattes", 1);
    assert.equal(lattes.session.lines.length, 1);
    assert.equal(lattes.session.lines[0]?.productId, "coffee-04");
    assert.equal(lattes.session.lines[0]?.quantity, 2);
    assert.equal(lattes.session.lines[0]?.temperature, "iced");

    const pretzels = answerWithRules(snacks(), "a couple of pretzels", 2);
    assert.equal(pretzels.session.lines.length, 1);
    assert.equal(pretzels.session.lines[0]?.productId, "snacks-22");
    assert.equal(pretzels.session.lines[0]?.quantity, 2);
  });

  it("answers gluten free and nut free without offering an item", () => {
    for (const phrase of ["is this gluten free?", "nut free?", "does it have milk"]) {
      const turn = answerWithRules(coffee(), phrase, 1);
      assert.equal(turn.session.lines.length, 0, phrase);
      assert.match(turn.say, /don't have allergen information/, phrase);
    }
  });

  it("says a cart edit in the pinned language", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const more = answerWithRules({ ...drafted.session, preferredLanguage: "es", languageSet: true }, "one more", 2);
    assert.equal(more.session.lines[0]?.quantity, 2);
    assert.match(more.say, /Añadí uno más de Latte/);
  });

  it("leaves the cart alone when the words are not an order", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    const aside = answerWithRules(drafted.session, "what time does the movie start", 2);
    assert.equal(aside.session.lines.length, 1);
    assert.equal(aside.session.lines[0]?.productId, "coffee-04");
    assert.equal(aside.session.lines[0]?.temperature, "iced");
    assert.equal(aside.session.phase, drafted.session.phase);
    assert.match(aside.say, /Anything else, or say confirm/);

    const browsing = answerWithRules(coffee(), "she was telling me the latte shop is closed", 3);
    assert.equal(browsing.session.lines.length, 0);
    assert.equal(browsing.say, "Didn't catch that.");

    const mumble = answerWithRules(coffee(), "and uh", 4);
    assert.equal(mumble.session.lines.length, 0);
    assert.equal(mumble.say, "Didn't catch that.");
  });

  it("does not let a model add a drink the customer did not name", () => {
    const blocked = heardForSpeech("what time does the movie start", {
      action: "add",
      lines: [{ productId: "coffee-04", temperature: "hot", quantity: 1 }],
      choices: [],
      menu: null,
    });
    assert.equal(blocked, null);
    const kept = heardForSpeech("I'll have the mocha please", {
      action: "add",
      lines: [{ productId: "coffee-06", temperature: "hot", quantity: 1 }],
      choices: [],
      menu: null,
    });
    assert.equal(kept?.lines[0]?.productId, "coffee-06");
  });

  it("refuses named other-catalog products when the unit is bound", () => {
    const previous = process.env.NEXT_PUBLIC_MACHINE_ID;
    process.env.NEXT_PUBLIC_MACHINE_ID = "coffee";
    try {
      for (const phrase of ["chips", "potato chips", "I want potato chips"]) {
        const turn = answerWithRules(coffee(), phrase, 1);
        assert.equal(turn.session.lines.length, 0, phrase);
        assert.equal(
          turn.say,
          "This machine doesn’t carry that. Pick from the menu, or say what you’d like.",
          phrase,
        );
      }
      const joined = answerWithRules(coffee(), "iced latte and potato chips", 2);
      assert.ok(joined.session.lines.every((line) => line.productId.startsWith("coffee-")), joined.say);
      assert.equal(
        joined.session.lines.some((line) => line.productId === "snacks-19"),
        false,
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_MACHINE_ID;
      else process.env.NEXT_PUBLIC_MACHINE_ID = previous;
    }

    process.env.NEXT_PUBLIC_MACHINE_ID = "snacks";
    try {
      for (const phrase of ["latte", "iced latte", "I want a mocha"]) {
        const turn = answerWithRules(snacks(), phrase, 3);
        assert.equal(turn.session.lines.length, 0, phrase);
        assert.equal(
          turn.say,
          "This machine doesn’t carry that. Pick from the menu, or say what you’d like.",
          phrase,
        );
      }
      const same = answerWithRules(snacks(), "potato chips", 4);
      assert.equal(same.session.lines.length, 1);
      assert.equal(same.session.lines[0]?.productId, "snacks-19");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_MACHINE_ID;
      else process.env.NEXT_PUBLIC_MACHINE_ID = previous;
    }
  });

  it("still adds across catalogs when the unit is unbound", () => {
    const previous = process.env.NEXT_PUBLIC_MACHINE_ID;
    delete process.env.NEXT_PUBLIC_MACHINE_ID;
    try {
      const both = answerWithRules(coffee(), "iced latte and potato chips", 1);
      assert.equal(both.session.lines.length, 2);
      assert.equal(both.session.lines[0]?.productId, "coffee-04");
      assert.equal(both.session.lines[1]?.productId, "snacks-19");
      const chips = answerWithRules(coffee(), "potato chips", 2);
      assert.equal(chips.session.lines.length, 1);
      assert.equal(chips.session.lines[0]?.productId, "snacks-19");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_MACHINE_ID;
      else process.env.NEXT_PUBLIC_MACHINE_ID = previous;
    }
  });
});

describe("Boost conversation script", () => {
  it("offers three priced hot drinks, then adds the pick hot and points to Review", () => {
    const asked = answerWithRules(coffee(), "What's nice that's hot to drink?", 1);
    assert.equal(asked.spotlightIds.length, 3);
    assert.ok(suit(asked.spotlightIds, "hot"));
    assert.equal(asked.session.lines.length, 0);
    assert.match(asked.say, /Mocha for \$\d\.\d\d/);
    assert.match(asked.say, /Each one comes hot/);

    const picked = answerWithRules(asked.session, "Let me get a mocha.", 2);
    assert.equal(picked.session.lines[0]?.productId, "coffee-06");
    assert.equal(picked.session.lines[0]?.temperature, "hot");
    assert.match(picked.say, /^Added: Mocha · hot, \$\d\.\d\d\./);
    assert.match(picked.say, /tap Confirm order/);
    assert.equal(picked.session.tempHint ?? null, null);
  });

  it("reads warm, cozy, iced and cold as temperatures and keeps English", () => {
    for (const phrase of ["something warm", "something cozy", "I'd like something hot"]) {
      const turn = answerWithRules(coffee(), phrase, 1);
      assert.ok(suit(turn.spotlightIds, "hot"), phrase);
      assert.equal(turn.session.preferredLanguage ?? "en", "en", phrase);
    }
    for (const phrase of ["something iced", "something cold"]) {
      const turn = answerWithRules(coffee(), phrase, 1);
      assert.ok(suit(turn.spotlightIds, "iced"), phrase);
      assert.match(turn.say, /Each one comes iced/, phrase);
    }
  });

  it("answers a drink we lack with the closest item from this machine", () => {
    const turn = answerWithRules(coffee(), "Let me get a hot chocolate.", 1);
    assert.equal(turn.session.lines.length, 0);
    assert.match(turn.say, /^We don’t have that\. The closest here is /);
    assert.ok(turn.spotlightIds.length > 0);
    assert.ok(turn.spotlightIds.every((id) => id.startsWith("coffee-")));
  });

  it("treats hot as spicy on the snack machine and has nothing cold", () => {
    const hot = answerWithRules(snacks(), "something hot", 1);
    assert.ok(hot.spotlightIds.length > 0);
    assert.ok(hot.spotlightIds.every((id) => id.startsWith("snacks-")));
    const cold = answerWithRules(snacks(), "something cold", 1);
    assert.deepEqual(cold.spotlightIds, []);
    assert.equal(cold.session.lines.length, 0);
  });

  it("greets with what the machine makes", () => {
    const coffeeAsk = answerWithRules(coffee(), "what drinks do you have", 1);
    assert.match(coffeeAsk.say, /Coffee, tea, matcha or juice, hot, iced or room temp/);
  });

  it("lets the AI suggest only this machine's items, priced, without adding", () => {
    const turn = applyHeard(coffee(), { action: "suggest", lines: [], choices: ["snacks-19", "coffee-04"], menu: null }, 1);
    assert.ok(turn);
    assert.deepEqual(turn.spotlightIds, ["coffee-04"]);
    assert.equal(turn.session.lines.length, 0);
    assert.match(turn.say, /^You could go for Latte for \$/);
  });

  it("picks temperature offers from what each drink suits, with tastes", () => {
    for (const phrase of ["whats nice and hot", "anything hot?", "hot and sweet", "hot but not too strong", "warm and chocolatey", "I'm freezing", "what's good when it's cold outside"]) {
      const turn = answerWithRules(coffee(), phrase, 1);
      assert.ok(suit(turn.spotlightIds, "hot"), phrase);
      assert.equal(turn.session.lines.length, 0, phrase);
    }
    for (const phrase of ["iced and sweet", "it's so hot outside"]) {
      assert.ok(suit(answerWithRules(coffee(), phrase, 1).spotlightIds, "iced"), phrase);
    }
    const notStrong = answerWithRules(coffee(), "hot but not too strong", 1);
    assert.ok(notStrong.spotlightIds.every((id) => !getItem(id)?.tasteTags.includes("strong")));
  });

  it("says we have no ingredient details instead of offering around an untagged ingredient", () => {
    for (const phrase of ["something hot without milk", "no milk please"]) {
      const turn = answerWithRules(coffee(), phrase, 1);
      assert.deepEqual(turn.spotlightIds, [], phrase);
      assert.match(turn.say, /allergen information/, phrase);
    }
  });
});

describe("Boost script follow-ups", () => {
  it("closes politely on no thanks and leaves the cart alone", () => {
    const offered = answerWithRules(coffee(), "something hot", 1);
    const declined = answerWithRules(offered.session, "no thanks", 2);
    assert.equal(declined.say, "No problem. Anything else?");
    assert.equal(declined.session.lines.length, 0);
  });

  it("lights the named drink but promises nothing for a latte without milk", () => {
    const turn = answerWithRules(coffee(), "a latte without milk", 1);
    assert.deepEqual(turn.spotlightIds, ["coffee-04"]);
    assert.equal(turn.session.lines.length, 0);
    assert.match(turn.say, /allergen information/);
  });

  it("uses taste words with a temperature, and relaxes the temperature when nothing suits", () => {
    const strong = answerWithRules(coffee(), "hot and strong", 1);
    assert.ok(strong.spotlightIds.every((id) => getItem(id)?.tasteTags.includes("strong")));
    const fruity = answerWithRules(coffee(), "something hot and fruity", 1);
    assert.ok(fruity.spotlightIds.length > 0);
    assert.ok(fruity.spotlightIds.every((id) => getItem(id)?.tasteTags.includes("fruity")));
    assert.match(fruity.say, /Each one comes hot/);
  });
});

describe("Review read-back wording", () => {
  it("never sends the customer to Review order from Review, in every language", async () => {
    const { APP_LANGUAGES, ui: screenText } = await import("../i18n");
    for (const language of APP_LANGUAGES) {
      const session = { ...coffee(), preferredLanguage: language, languageSet: true };
      const added = answerWithRules(session, "iced latte", 1);
      assert.ok(added.readBack, language);
      assert.ok(!added.say.includes(screenText(language, "review_order")), `${language}: ${added.say}`);
      assert.ok(added.say.includes(screenText(language, "confirm")), `${language}: ${added.say}`);
      const read = runTool(added.session, "read_back", {}, 2);
      assert.ok(!read.say.includes(screenText(language, "review_order")), `${language}: ${read.say}`);
      assert.ok(read.say.includes(screenText(language, "confirm")), `${language}: ${read.say}`);
    }
  });
});
