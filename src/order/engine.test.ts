import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDLE_ABANDON_MS,
  IDLE_PROMPT_MS,
  apply,
  createSession,
  type OrderSession,
} from "./engine";

const LATTE = "coffee-04";
const ESPRESSO = "coffee-17";
const COVERED = "coffee-15";
const CHIPS = "snacks-19";

function coffee(now = 0): OrderSession {
  return createSession({ id: "order-1", machineId: "coffee", now });
}

function snacks(now = 0): OrderSession {
  return createSession({ id: "order-2", machineId: "snacks", now });
}

describe("order engine", () => {
  it("keeps the idle timings used in the decision log", () => {
    assert.equal(IDLE_PROMPT_MS, 20_000);
    assert.equal(IDLE_ABANDON_MS, 45_000);
  });

  it("refuses a drink with no temperature and accepts it once the temperature is set", () => {
    const added = apply(coffee(), { type: "add", productId: LATTE, now: 1 });
    assert.equal(added.ok, true);
    assert.equal(added.session.phase, "drafting");
    assert.deepEqual(added.missing, [
      { lineId: "L1", productId: LATTE, field: "temperature" },
    ]);

    const blocked = apply(added.session, { type: "read_back", now: 2 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "incomplete");
    assert.equal(blocked.session.cartVersion, added.session.cartVersion);
    assert.equal(blocked.session.phase, "drafting");

    const tooSoon = apply(added.session, {
      type: "confirm",
      cartVersion: added.session.cartVersion,
      source: "voice_yes",
      now: 3,
    });
    assert.equal(tooSoon.ok, false);
    assert.equal(tooSoon.reason, "not_awaiting_confirmation");

    const iced = apply(added.session, {
      type: "set_temperature",
      lineId: "L1",
      temperature: "iced",
      now: 4,
    });
    assert.equal(iced.ok, true);
    assert.equal(iced.session.lines[0]?.temperature, "iced");
    assert.deepEqual(iced.missing, []);

    const read = apply(iced.session, { type: "read_back", now: 5 });
    assert.equal(read.ok, true);
    assert.equal(read.session.phase, "awaiting_confirmation");
    assert.equal(read.readBack?.lines[0]?.name, "Latte");
    assert.equal(read.readBack?.lines[0]?.temperature, "iced");
    assert.equal(read.readBack?.totalCents, 360);

    const paid = apply(read.session, {
      type: "confirm",
      cartVersion: read.session.cartVersion,
      source: "confirm_tap",
      now: 6,
    });
    assert.equal(paid.ok, true);
    assert.equal(paid.session.phase, "ready_to_pay");
    assert.equal(paid.session.confirmedBy, "confirm_tap");
  });

  it("still requires a temperature for Covered Cup", () => {
    const added = apply(coffee(), { type: "add", productId: COVERED, now: 1 });
    const read = apply(added.session, { type: "read_back", now: 2 });
    assert.equal(read.ok, false);
    assert.equal(read.reason, "incomplete");
  });

  it("rejects an item from the other machine and an item that does not exist", () => {
    const start = coffee();
    const other = apply(start, { type: "add", productId: CHIPS, now: 1 });
    assert.equal(other.ok, false);
    assert.equal(other.reason, "wrong_machine");
    assert.equal(other.session.phase, "browsing");
    assert.equal(other.session.lines.length, 0);
    assert.equal(other.session.cartVersion, 0);
    assert.equal(other.session.lastActivityAt, 1);

    const missing = apply(start, { type: "add", productId: "burger", now: 2 });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "unknown_product");
    assert.equal(missing.session.lines.length, 0);
  });

  it("completes a snack without a temperature and rejects a temperature on it", () => {
    const added = apply(snacks(), { type: "add", productId: CHIPS, quantity: 2, now: 1 });
    assert.equal(added.ok, true);
    assert.deepEqual(added.missing, []);

    const flavored = apply(added.session, {
      type: "set_temperature",
      lineId: "L1",
      temperature: "hot",
      now: 2,
    });
    assert.equal(flavored.ok, false);
    assert.equal(flavored.reason, "temperature_not_allowed");
    assert.equal(flavored.session.cartVersion, added.session.cartVersion);

    const read = apply(added.session, { type: "read_back", now: 3 });
    const yes = apply(read.session, {
      type: "confirm",
      cartVersion: read.session.cartVersion,
      source: "voice_yes",
      now: 4,
    });
    assert.equal(yes.ok, true);
    assert.equal(yes.session.phase, "ready_to_pay");
    assert.equal(yes.session.confirmedBy, "voice_yes");
    assert.equal(yes.readBack?.totalCents, 400);
  });

  it("rejects yes after the cart changes, until the new cart is read back", () => {
    let session = coffee();
    session = apply(session, {
      type: "add",
      productId: LATTE,
      temperature: "hot",
      now: 1,
    }).session;
    const read = apply(session, { type: "read_back", now: 2 });
    assert.equal(read.session.phase, "awaiting_confirmation");
    const seen = read.session.cartVersion;

    const changed = apply(read.session, {
      type: "add",
      productId: ESPRESSO,
      temperature: "hot",
      now: 3,
    });
    assert.equal(changed.session.phase, "drafting");
    assert.notEqual(changed.session.cartVersion, seen);

    const oldYes = apply(changed.session, {
      type: "confirm",
      cartVersion: seen,
      source: "voice_yes",
      now: 4,
    });
    assert.equal(oldYes.ok, false);
    assert.equal(oldYes.reason, "stale_cart");
    assert.equal(oldYes.session.phase, "drafting");

    const newYesWithoutReadBack = apply(changed.session, {
      type: "confirm",
      cartVersion: changed.session.cartVersion,
      source: "voice_yes",
      now: 5,
    });
    assert.equal(newYesWithoutReadBack.ok, false);
    assert.equal(newYesWithoutReadBack.reason, "not_awaiting_confirmation");

    const reread = apply(changed.session, { type: "read_back", now: 6 });
    const yes = apply(reread.session, {
      type: "confirm",
      cartVersion: reread.session.cartVersion,
      source: "voice_yes",
      now: 7,
    });
    assert.equal(yes.ok, true);
    assert.equal(yes.readBack?.lines.length, 2);
  });

  it("treats silence as no activity and walks away after the idle window", () => {
    const added = apply(coffee(), {
      type: "add",
      productId: LATTE,
      temperature: "room",
      now: 0,
    });
    const quiet = apply(added.session, { type: "silence", now: 19_000 });
    assert.equal(quiet.ok, true);
    assert.equal(quiet.session.cartVersion, added.session.cartVersion);
    assert.equal(quiet.session.phase, "drafting");
    assert.equal(quiet.session.lastActivityAt, added.session.lastActivityAt);
    assert.deepEqual(quiet.session.lines, added.session.lines);

    const stillHere = apply(quiet.session, { type: "tick", now: 19_999 });
    assert.equal(stillHere.idlePrompt, false);
    assert.equal(stillHere.session.phase, "drafting");

    const prompt = apply(quiet.session, { type: "tick", now: IDLE_PROMPT_MS });
    assert.equal(prompt.ok, true);
    assert.equal(prompt.idlePrompt, true);
    assert.equal(prompt.session.phase, "drafting");
    assert.equal(prompt.session.lines.length, 1);

    const promptedAgain = apply(prompt.session, { type: "tick", now: IDLE_PROMPT_MS + 1_000 });
    assert.equal(promptedAgain.idlePrompt, false);
    assert.equal(promptedAgain.session.phase, "drafting");

    const left = apply(prompt.session, { type: "tick", now: IDLE_ABANDON_MS });
    assert.equal(left.session.phase, "abandoned");
    assert.equal(left.session.lines.length, 0);
    assert.equal(left.idlePrompt, false);

    const paid = apply(prompt.session, { type: "read_back", now: IDLE_PROMPT_MS });
    const confirmed = apply(paid.session, {
      type: "confirm",
      cartVersion: paid.session.cartVersion,
      source: "confirm_tap",
      now: IDLE_PROMPT_MS,
    });
    const stayed = apply(confirmed.session, { type: "tick", now: IDLE_PROMPT_MS + IDLE_ABANDON_MS });
    assert.equal(stayed.session.phase, "ready_to_pay");
    assert.equal(stayed.session.lines.length, 1);
    assert.equal(stayed.idlePrompt, false);

    const lateYes = apply(left.session, {
      type: "confirm",
      cartVersion: added.session.cartVersion,
      source: "voice_yes",
      now: IDLE_ABANDON_MS + 1,
    });
    assert.equal(lateYes.ok, false);
    assert.equal(lateYes.reason, "session_abandoned");
    assert.equal(lateYes.session.lines.length, 0);
  });

  it("starts the idle clock again when the customer comes back", () => {
    const added = apply(snacks(), { type: "add", productId: CHIPS, now: 0 });
    const prompt = apply(added.session, { type: "tick", now: IDLE_PROMPT_MS });
    assert.equal(prompt.idlePrompt, true);

    const back = apply(prompt.session, { type: "silence", now: IDLE_PROMPT_MS + 1_000 });
    assert.equal(back.session.idlePrompted, true);

    const spoke = apply(prompt.session, {
      type: "set_quantity",
      lineId: "L1",
      quantity: 2,
      now: 25_000,
    });
    assert.equal(spoke.session.idlePrompted, false);
    const notYet = apply(spoke.session, { type: "tick", now: 25_000 + IDLE_PROMPT_MS - 1 });
    assert.equal(notYet.idlePrompt, false);
    const again = apply(spoke.session, { type: "tick", now: 25_000 + IDLE_PROMPT_MS });
    assert.equal(again.idlePrompt, true);
    assert.equal(again.session.phase, "drafting");
  });

  it("drops ready-to-pay when the customer changes the cart", () => {
    let session = snacks();
    session = apply(session, { type: "add", productId: CHIPS, now: 1 }).session;
    session = apply(session, { type: "read_back", now: 2 }).session;
    session = apply(session, {
      type: "confirm",
      cartVersion: session.cartVersion,
      source: "voice_yes",
      now: 3,
    }).session;
    assert.equal(session.phase, "ready_to_pay");

    const removed = apply(session, { type: "remove_line", lineId: "L1", now: 4 });
    assert.equal(removed.session.phase, "browsing");
    assert.equal(removed.session.confirmedBy, null);
    const yes = apply(removed.session, {
      type: "confirm",
      cartVersion: removed.session.cartVersion,
      source: "confirm_tap",
      now: 5,
    });
    assert.equal(yes.reason, "not_awaiting_confirmation");
  });

  it("merges a repeated product at the same temperature", () => {
    const first = apply(coffee(), {
      type: "add",
      productId: ESPRESSO,
      temperature: "hot",
      now: 1,
    });
    const second = apply(first.session, {
      type: "add",
      productId: ESPRESSO,
      temperature: "iced",
      now: 2,
    });
    assert.equal(second.session.lines.length, 2);

    const same = apply(second.session, {
      type: "add",
      productId: ESPRESSO,
      temperature: "hot",
      quantity: 2,
      now: 3,
    });
    assert.equal(same.session.lines.length, 2);
    const hot = same.session.lines.find((line) => line.temperature === "hot");
    assert.equal(hot?.quantity, 3);
  });

  it("lets the customer stay, step back from review, or cancel", () => {
    const added = apply(coffee(), {
      type: "add",
      productId: LATTE,
      temperature: "hot",
      now: 0,
    });
    const prompt = apply(added.session, { type: "tick", now: IDLE_PROMPT_MS });
    const stay = apply(prompt.session, { type: "activity", now: IDLE_PROMPT_MS + 1 });
    assert.equal(stay.ok, true);
    assert.equal(stay.session.idlePrompted, false);
    assert.equal(stay.session.cartVersion, added.session.cartVersion);
    assert.equal(stay.session.lines.length, 1);

    const read = apply(stay.session, { type: "read_back", now: 100 });
    const back = apply(read.session, { type: "revise", now: 101 });
    assert.equal(back.session.phase, "drafting");
    assert.equal(back.session.cartVersion, read.session.cartVersion);
    assert.equal(back.session.readBackVersion, null);

    const yes = apply(back.session, {
      type: "confirm",
      cartVersion: back.session.cartVersion,
      source: "confirm_tap",
      now: 102,
    });
    assert.equal(yes.reason, "not_awaiting_confirmation");

    const cancelled = apply(back.session, { type: "cancel", now: 103 });
    assert.equal(cancelled.session.phase, "abandoned");
    assert.equal(cancelled.session.lines.length, 0);
    const late = apply(cancelled.session, {
      type: "confirm",
      cartVersion: read.session.cartVersion,
      source: "confirm_tap",
      now: 104,
    });
    assert.equal(late.reason, "session_abandoned");
  });
});
