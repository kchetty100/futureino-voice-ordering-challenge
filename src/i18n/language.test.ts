import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerWithRules } from "../agent/rules";
import { createSession } from "../order/engine";
import { detectLanguage, parseLanguageChoice } from "./detect";
import { applyLanguageCue } from "./session";
import { ui } from "./chrome";
import { t } from "./phrases";

function coffee(now = 0) {
  return createSession({ id: "order-1", machineId: "coffee", now });
}

describe("language detection", () => {
  it("maps explicit language choices", () => {
    assert.equal(parseLanguageChoice("speak Spanish"), "es");
    assert.equal(parseLanguageChoice("en español"), "es");
    assert.equal(parseLanguageChoice("in English"), "en");
    assert.equal(parseLanguageChoice("français"), "fr");
    assert.equal(parseLanguageChoice("עברית"), "he");
    assert.equal(parseLanguageChoice("in Afrikaans"), "af");
  });

  it("detects non-English function words and Hebrew script", () => {
    assert.equal(detectLanguage("hola, quiero un café"), "es");
    assert.equal(detectLanguage("bonjour, je voudrais un café"), "fr");
    assert.equal(detectLanguage("אני רוצה קפה"), "he");
    assert.equal(detectLanguage("ek wil asseblief koffie hê"), "af");
    assert.equal(detectLanguage("I want something else"), "en");
    // Bare English catalog name is not enough to lock English.
    assert.equal(detectLanguage("latte"), null);
    assert.equal(ui("es", "welcome"), "Bienvenido");
    assert.equal(ui("he", "back"), "חזרה");
    assert.equal(ui("en", "welcome"), "Welcome");
  });

  it("stores preferred language once detected and only switches on explicit choice", () => {
    let fields = applyLanguageCue({ preferredLanguage: "en", languageSet: false }, "hola, quiero un café").fields;
    assert.equal(fields.preferredLanguage, "es");
    assert.equal(fields.languageSet, true);

    fields = applyLanguageCue(fields, "I want a latte").fields;
    assert.equal(fields.preferredLanguage, "es");

    const switched = applyLanguageCue(fields, "speak English");
    assert.equal(switched.fields.preferredLanguage, "en");
    assert.match(switched.ack ?? "", /English|inglés|anglais|אנגלית|Engels/i);
  });
});

describe("non-English phrase path", () => {
  it("replies in Spanish for greetings, cart, allergens, and confirm read-back", () => {
    const started = createSession({
      id: "es-1",
      machineId: "coffee",
      now: 0,
      preferredLanguage: "es",
      languageSet: true,
    });

    const allergens = answerWithRules(started, "¿tiene alérgenos?", 1);
    assert.equal(allergens.session.preferredLanguage, "es");
    assert.match(allergens.say, /alérgenos|ingredientes/i);
    assert.doesNotMatch(allergens.say, /I don't have allergen/);

    const drafted = answerWithRules(started, "iced latte", 2);
    assert.equal(drafted.session.phase, "awaiting_confirmation");
    assert.match(drafted.say, /Total/);
    assert.match(drafted.say, /toca Confirmar pedido/);
    assert.doesNotMatch(drafted.say, /Would you like to add anything else/);

    const cart = answerWithRules(drafted.session, "muestra el carrito", 3);
    assert.equal(cart.ui, "open_cart");
    assert.equal(cart.say, t("es", "heres_cart"));

    const cleared = answerWithRules(drafted.session, "vaciar carrito", 4);
    assert.equal(cleared.say, t("es", "cart_cleared"));
    assert.equal(cleared.session.lines.length, 0);
  });

  it("locks Spanish after detecting it mid-session", () => {
    const turn = answerWithRules(coffee(), "hola, quiero ver el carrito", 1);
    assert.equal(turn.session.preferredLanguage, "es");
    assert.equal(turn.session.languageSet, true);
    assert.equal(turn.ui, "open_cart");
    assert.equal(turn.say, t("es", "cart_empty"));
  });
});
