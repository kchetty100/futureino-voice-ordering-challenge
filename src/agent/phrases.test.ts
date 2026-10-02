import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPromptEcho, speechPrompt } from "../catalog/index";
import { createSession, type OrderSession } from "../order/engine";
import { isHeyFuture, requestedMachine, wakeSay } from "./arrive";
import { parseNavIntent } from "./nav";
import { answerWithRules } from "./rules";
import { applyHeard, parseHeard } from "./understand";

function coffee(now = 0): OrderSession {
  return createSession({ id: "order-1", machineId: "coffee", now });
}

describe("customer phrases", () => {
  it("maps a phrase to one item and asks when two items share it", () => {
    const bag = answerWithRules(coffee(), "the yellow bag", 1);
    assert.equal(bag.session.lines.length, 1);
    assert.equal(bag.session.lines[0]?.productId, "snacks-19");

    const pretzel = answerWithRules(coffee(), "iced latte and a pretzel", 2);
    assert.equal(pretzel.session.lines[0]?.productId, "coffee-04");
    assert.equal(pretzel.session.lines[0]?.temperature, "iced");
    assert.equal(pretzel.session.lines[1]?.productId, "snacks-22");

    const black = answerWithRules(coffee(), "hot black coffee", 3);
    assert.equal(black.session.lines.length, 0);
    assert.match(black.say, /Americano/);
    assert.match(black.say, /Daily Black/);
    assert.doesNotMatch(black.say, /Black Tea/);

    const crunchy = answerWithRules(coffee(), "something crunchy", 4);
    assert.equal(crunchy.session.lines.length, 0);
    assert.match(crunchy.say, /I can offer/);
    assert.doesNotMatch(crunchy.say, /doesn't carry/);
  });

  it("opens the next screen only for Hey Future", () => {
    assert.equal(isHeyFuture("Hey Future"), true);
    assert.equal(isHeyFuture("hey, future!"), true);
    assert.equal(isHeyFuture("Hay Future please"), true);
    assert.equal(isHeyFuture("future"), false);
    assert.equal(isHeyFuture("hey"), false);
    assert.equal(isHeyFuture("iced latte"), false);
    assert.equal(wakeSay("Hey Future", "en"), "Welcome. Please make a selection from below.");
    assert.equal(wakeSay("latte", "en"), null);
    assert.match(wakeSay("", "es") ?? "", /escuch/);
  });

  it("gives the transcriber every name and customer phrase", () => {
    const prompt = speechPrompt();
    assert.match(prompt, /Americano/);
    assert.match(prompt, /Pretzels/);
    assert.match(prompt, /yellow bag/);
    assert.match(prompt, /black coffee/);
    assert.equal(prompt.startsWith("What snacks"), false);
    assert.equal(isPromptEcho("Futureino menu words"), true);
    assert.equal(isPromptEcho("What snacks do you have?"), false);
    assert.equal(isPromptEcho("iced latte"), false);
    assert.equal(isPromptEcho("Hey Future"), false);
    assert.equal(isPromptEcho("context: ### Futureino menu words. Americano (black coffee, long black)"), true);
  });

  it("adds only real menu ids from a mapped sentence", () => {
    const dropped = parseHeard({
      action: "add",
      lines: [
        { productId: "burger", temperature: "hot" },
        { productId: "snacks-19", temperature: "hot" },
      ],
      choices: [],
      menu: "none",
    });
    assert.equal(dropped?.lines.length, 1);
    assert.equal(dropped?.lines[0]?.productId, "snacks-19");

    const snack = applyHeard(coffee(), dropped!, 1);
    assert.equal(snack?.session.lines.length, 1);
    assert.equal(snack?.session.lines[0]?.productId, "snacks-19");
    assert.equal(snack?.session.lines[0]?.temperature, undefined);

    const drink = applyHeard(
      coffee(),
      { action: "add", lines: [{ productId: "coffee-04", temperature: "iced" }], choices: [], menu: null },
      2,
    );
    assert.equal(drink?.session.lines[0]?.temperature, "iced");

    const choice = applyHeard(
      coffee(),
      { action: "clarify", lines: [], choices: ["coffee-01", "coffee-05"], menu: null },
      3,
    );
    assert.equal(choice?.session.lines.length, 0);
    assert.match(choice?.say ?? "", /Americano/);
    assert.match(choice?.say ?? "", /Daily Black/);

    const invented = applyHeard(coffee(), { action: "add", lines: [], choices: [], menu: null }, 4);
    assert.equal(invented, null);
    const none = applyHeard(coffee(), { action: "none", lines: [], choices: [], menu: null }, 5);
    assert.equal(none, null);
  });
});

describe("navigation phrases", () => {
  it("maps cart, scroll, clear, and machine screen phrases", () => {
    for (const phrase of ["show me the cart", "open cart", "view cart", "check my order"]) {
      assert.deepEqual(parseNavIntent(phrase), { kind: "ui", ui: "open_cart" });
    }
    for (const phrase of ["scroll up", "page up"]) {
      assert.deepEqual(parseNavIntent(phrase), { kind: "ui", ui: "scroll_up" });
    }
    for (const phrase of ["scroll down", "page down", "go down"]) {
      assert.deepEqual(parseNavIntent(phrase), { kind: "ui", ui: "scroll_down" });
    }
    for (const phrase of ["go back", "back", "previous page", "previous screen", "take me back", "last page", "I want to go back"]) {
      assert.deepEqual(parseNavIntent(phrase), { kind: "ui", ui: "go_back" });
    }
    assert.equal(parseNavIntent("go back to coffee"), null);
    assert.equal(parseNavIntent("return to coffee screen"), null);
    assert.deepEqual(parseNavIntent("go up"), { kind: "ui", ui: "scroll_up" });
    for (const phrase of ["clear cart", "empty cart", "clear the order"]) {
      assert.deepEqual(parseNavIntent(phrase), { kind: "clear_cart" });
    }
    assert.equal(parseNavIntent("remove the latte"), null);
    assert.equal(parseNavIntent("iced latte"), null);

    assert.equal(requestedMachine("return to coffee screen"), "coffee");
    assert.equal(requestedMachine("show coffee"), "coffee");
    assert.equal(requestedMachine("coffee machine"), "coffee");
    assert.equal(requestedMachine("return to snack screen"), "snacks");
    assert.equal(requestedMachine("show snacks"), "snacks");
    assert.equal(requestedMachine("snacks"), "snacks");
  });

  it("opens the cart overlay, scrolls, clears, and switches machines without breaking confirm", () => {
    const drafted = answerWithRules(coffee(), "iced latte", 1);
    assert.equal(drafted.session.phase, "awaiting_confirmation");

    const cart = answerWithRules(drafted.session, "show me the cart", 2);
    assert.equal(cart.ui, "open_cart");
    assert.equal(cart.session.phase, "awaiting_confirmation");
    assert.equal(cart.session.lines.length, 1);
    assert.ok(cart.readBack);

    const up = answerWithRules(drafted.session, "scroll up", 3);
    assert.equal(up.ui, "scroll_up");
    assert.equal(up.session.lines.length, 1);
    assert.equal(up.session.phase, "awaiting_confirmation");

    const snacks = answerWithRules(drafted.session, "return to snack screen", 4);
    assert.equal(snacks.switchTo, "snacks");
    assert.equal(snacks.session.lines.length, 1);
    assert.equal(snacks.ui, null);

    const coffeeScreen = answerWithRules(drafted.session, "coffee machine", 5);
    assert.equal(coffeeScreen.switchTo, "coffee");

    const cleared = answerWithRules(drafted.session, "clear cart", 6);
    assert.equal(cleared.session.lines.length, 0);
    assert.equal(cleared.session.phase, "browsing");
    assert.equal(cleared.say, "Cart cleared.");
    assert.equal(cleared.ui, null);

    const back = answerWithRules(drafted.session, "previous page", 8);
    assert.equal(back.ui, "go_back");
    assert.equal(back.session.lines.length, 1);
    assert.equal(back.session.phase, "awaiting_confirmation");
    assert.equal(back.say, "Going back.");

    const yes = answerWithRules(drafted.session, "yes", 7);
    assert.equal(yes.session.phase, "ready_to_pay");
    assert.equal(yes.session.confirmedBy, "voice_yes");
  });
});
