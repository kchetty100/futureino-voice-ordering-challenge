import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passwordMatches } from "./access";
import { estimateSpeech, estimateUsd, transcribeUsage } from "./cost";
import { orderTotal } from "./format";
import { noteUsageFor, operatorSession } from "./log";
import { commandSession, messageSession, openSession } from "../session/store";

describe("operator log", () => {
  it("prices a million input tokens and a minute of transcription", () => {
    const chat = estimateUsd([{ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0, audioSeconds: 0 }]);
    assert.equal(Math.round(chat * 100), 15);
    const heard = estimateUsd([transcribeUsage({}, 60)]);
    assert.equal(Math.round(heard * 10_000), 30);
    const spoken = estimateSpeech("Please view the items below.");
    assert.ok(spoken.outputTokens > 0);
    assert.ok(estimateUsd([spoken]) > 0);
  });

  it("keeps the transcript and each cart version", async () => {
    const opened = await openSession("coffee", 1_000);
    const id = opened.session?.id;
    assert.ok(id);
    const drafted = await messageSession(id, "iced latte", 2_000, "text");
    assert.equal(drafted?.session?.phase, "awaiting_confirmation");
    noteUsageFor(id, { model: "gpt-4o-mini-transcribe", inputTokens: 0, outputTokens: 0, audioSeconds: 60 });

    const view = await operatorSession(id);
    assert.ok(view);
    assert.equal(view.transcript[0]?.customer, "iced latte");
    assert.match(view.transcript[0]?.say ?? "", /Latte/);
    assert.equal(view.carts[0]?.lines.length, 0);
    assert.equal(orderTotal(view), "$3.60");
    assert.equal(view.carts.at(-1)?.lines[0]?.name, "Latte");
    assert.equal(view.carts.at(-1)?.lines[0]?.temperature, "iced");
    assert.equal(view.carts.at(-1)?.phase, "awaiting_confirmation");
    assert.equal(Math.round(view.costUsd * 10_000), 30);

    const before = view.transcript.length;
    await commandSession(id, { type: "tick" }, 3_000);
    assert.equal((await operatorSession(id))?.transcript.length, before);

    const confirmed = await commandSession(id, { type: "confirm", cartVersion: view.carts.at(-1)?.cartVersion ?? 0, source: "confirm_tap" }, 4_000);
    assert.equal(confirmed?.session?.phase, "ready_to_pay");
    const after = await operatorSession(id);
    assert.equal(after?.phase, "ready_to_pay");
    assert.match(after?.transcript.at(-1)?.customer ?? "", /confirm/);
  });

  it("checks the operator password without revealing it", () => {
    const previous = process.env.OPERATOR_PASSWORD;
    process.env.OPERATOR_PASSWORD = "counter-review";
    assert.equal(passwordMatches("counter-review"), true);
    assert.equal(passwordMatches("nope"), false);
    if (previous === undefined) delete process.env.OPERATOR_PASSWORD;
    else process.env.OPERATOR_PASSWORD = previous;
  });
});