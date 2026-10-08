import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getItem, type MachineId } from "../catalog/index";
import { createSession } from "../order/engine";
import { parsePreference, preferredItems } from "./prefer";
import { answerWithRules, mentionsOrder } from "./rules";

const MISS = "This machine doesn’t carry that. Pick from the menu, or say what you’d like.";

function open(machineId: MachineId) {
  return createSession({ id: `p-${machineId}`, machineId, now: 0 });
}

/** Two or three real items from this machine, spotlighted, named in the line, and nothing in the cart. */
function assertOffer(machineId: MachineId, phrase: string, before = open(machineId)) {
  const turn = answerWithRules(before, phrase, 1);
  assert.match(turn.say, /^You could go for /, `${machineId}: ${phrase}`);
  assert.doesNotMatch(turn.say, /carry/, `${machineId}: ${phrase}`);
  assert.ok(turn.spotlightIds.length >= 2 && turn.spotlightIds.length <= 3, `${machineId}: ${phrase} → ${turn.spotlightIds}`);
  for (const id of turn.spotlightIds) {
    const item = getItem(id);
    assert.ok(item, `${phrase}: ${id} is on the menu`);
    assert.equal(item.machineId, machineId, `${phrase}: ${id} is on ${machineId}`);
    assert.ok(turn.say.includes(item.name), `${phrase}: says ${item.name}`);
  }
  assert.deepEqual(turn.session.lines, before.lines, `${machineId}: ${phrase} leaves the cart alone`);
  assert.equal(turn.session.phase, before.phase, `${machineId}: ${phrase} keeps the phase`);
  return turn;
}

describe("vague preferences", () => {
  it("suggests sweet, lighter items from this machine for the brief's question", () => {
    const drinks = assertOffer("coffee", "something sweet but not too heavy?");
    for (const id of drinks.spotlightIds) {
      const tags = getItem(id)?.tasteTags ?? [];
      assert.ok(tags.includes("sweet"), id);
      assert.ok(!tags.includes("rich"), id);
    }
    const snacks = assertOffer("snacks", "something sweet but not too heavy?");
    for (const id of snacks.spotlightIds) {
      const tags = getItem(id)?.tasteTags ?? [];
      assert.ok(tags.includes("sweet"), id);
      assert.ok(!tags.includes("rich"), id);
    }
    assert.equal(snacks.spotlightIds[0], "snacks-18");
  });

  it("answers each vague ask with real matches and never adds", () => {
    const phrases = [
      "something sweet",
      "not too heavy",
      "what do you recommend?",
      "what would you recommend",
      "any recommendations?",
      "something light",
      "I want something sweet",
      "surprise me",
      "what's good?",
      "nothing heavy please",
      "not too sweet",
    ];
    for (const machineId of ["coffee", "snacks"] as const) {
      for (const phrase of phrases) {
        assert.equal(mentionsOrder(phrase), true, phrase);
        assertOffer(machineId, phrase);
      }
    }
  });

  it("filters by taste tags and keeps rich items out of a light ask", () => {
    const light = answerWithRules(open("coffee"), "not too heavy", 1);
    for (const id of light.spotlightIds) assert.ok(!getItem(id)?.tasteTags.includes("rich"), id);
    const salty = assertOffer("snacks", "something salty");
    for (const id of salty.spotlightIds) assert.ok(getItem(id)?.tasteTags.includes("salty"), id);
    const notSweet = answerWithRules(open("snacks"), "not too sweet", 1);
    for (const id of notSweet.spotlightIds) assert.ok(!getItem(id)?.tasteTags.includes("sweet"), id);
  });

  it("does not suggest from the other machine", () => {
    const sweet = assertOffer("coffee", "something sweet");
    assert.ok(sweet.spotlightIds.every((id) => id.startsWith("coffee-")));
    const askedOther = answerWithRules(open("coffee"), "something sweet from the snack machine", 1);
    assert.equal(askedOther.say, "That item is not on this machine.");
    assert.deepEqual(askedOther.spotlightIds, []);
    assert.equal(askedOther.session.lines.length, 0);
  });

  it("offers during review without touching the cart", () => {
    const drafted = answerWithRules(open("coffee"), "iced latte", 1);
    assert.equal(drafted.session.phase, "awaiting_confirmation");
    assertOffer("coffee", "something sweet but not too heavy?", drafted.session);
  });

  it("refuses a taste this machine has nothing for, with a steer", () => {
    const crunchy = answerWithRules(open("coffee"), "something crunchy", 1);
    assert.equal(crunchy.say, MISS);
    assert.deepEqual(crunchy.spotlightIds, []);
    assert.equal(crunchy.session.lines.length, 0);
  });

  it("keeps named products on the normal path", () => {
    assert.equal(parsePreference("spiced chai"), null);
    assert.equal(parsePreference("chocolate chip cookies"), null);
    assert.equal(parsePreference("fruit gummies"), null);
    assert.equal(parsePreference("lemon tea"), null);
    const chai = answerWithRules(open("coffee"), "spiced chai", 1);
    assert.equal(chai.session.lines[0]?.productId, "coffee-07");
  });

  it("reads negation and the other kiosk languages", () => {
    assert.deepEqual(parsePreference("something sweet but not too heavy?"), { want: ["sweet"], avoid: [], light: true, recommend: false, temperature: null, ingredient: false });
    assert.deepEqual(parsePreference("not too sweet"), { want: [], avoid: ["sweet"], light: false, recommend: false, temperature: null, ingredient: false });
    assert.deepEqual(parsePreference("what do you recommend?"), { want: [], avoid: [], light: false, recommend: true, temperature: null, ingredient: false });
    assert.deepEqual(parsePreference("algo dulce pero no muy pesado"), { want: ["sweet"], avoid: [], light: true, recommend: false, temperature: null, ingredient: false });
    assert.equal(parsePreference("what time does the movie start"), null);
    assert.equal(parsePreference("I want to go home"), null);
  });

  it("only ever returns real items from the asked machine", () => {
    for (const machineId of ["coffee", "snacks"] as const) {
      for (const phrase of ["something sweet", "what do you recommend", "something light", "something fruity"]) {
        const preference = parsePreference(phrase);
        assert.ok(preference, phrase);
        for (const item of preferredItems(machineId, preference)) {
          assert.equal(getItem(item.id), item);
          assert.equal(item.machineId, machineId);
          assert.ok(item.tasteTags.length > 0, `${item.id} has taste tags`);
        }
      }
    }
  });
});

describe("items the machine does not carry", () => {
  it("refuses a burger or pizza and leaves the cart alone", () => {
    const phrases = ["a burger", "burger", "pizza", "can I get a pizza", "I want a burger please", "do you have pizza?"];
    for (const machineId of ["coffee", "snacks"] as const) {
      for (const phrase of phrases) {
        assert.equal(mentionsOrder(phrase), true, phrase);
        const turn = answerWithRules(open(machineId), phrase, 1);
        assert.equal(turn.say, MISS, `${machineId}: ${phrase}`);
        assert.deepEqual(turn.spotlightIds, [], phrase);
        assert.equal(turn.session.lines.length, 0, phrase);
      }
    }
    const drafted = answerWithRules(open("snacks"), "potato chips", 1);
    const missing = answerWithRules(drafted.session, "can I get a pizza", 2);
    assert.equal(missing.say, MISS);
    assert.deepEqual(missing.session.lines, drafted.session.lines);
  });

  it("does not treat nearby talk as a missing item", () => {
    for (const phrase of ["I want to go home", "give me a minute", "what time does the movie start"]) {
      const turn = answerWithRules(open("coffee"), phrase, 1);
      assert.equal(turn.say, "Didn't catch that.", phrase);
    }
  });

  it("says the steer in each kiosk language", () => {
    const expected = {
      es: /Elige del menú/,
      fr: /Choisissez dans le menu/,
      he: /בחר מהתפריט/,
      af: /Kies van die spyskaart/,
    } as const;
    for (const [language, pattern] of Object.entries(expected)) {
      const session = { ...open("coffee"), preferredLanguage: language as keyof typeof expected, languageSet: true };
      const turn = answerWithRules(session, "burger", 1);
      assert.match(turn.say, pattern, language);
    }
  });
});
