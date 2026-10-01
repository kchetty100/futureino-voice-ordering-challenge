import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { speechPrompt } from "../catalog/index";
import { createSession, type OrderSession } from "../order/engine";
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

  it("gives the transcriber every name and customer phrase", () => {
    const prompt = speechPrompt();
    assert.match(prompt, /Americano/);
    assert.match(prompt, /Pretzels/);
    assert.match(prompt, /yellow bag/);
    assert.match(prompt, /black coffee/);
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
