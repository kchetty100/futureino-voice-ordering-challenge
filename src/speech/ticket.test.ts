import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { claimSpeakTicket, issueSpeakTicket, resetSpeakTickets } from "./ticket";

describe("speak permit", () => {
  const previousPassword = process.env.OPERATOR_PASSWORD;
  const previousKey = process.env.OPENAI_API_KEY;

  after(() => {
    restore(previousPassword, "OPERATOR_PASSWORD");
    restore(previousKey, "OPENAI_API_KEY");
    resetSpeakTickets();
  });

  it("speaks a line once, and only that line", async () => {
    process.env.OPERATOR_PASSWORD = "ticket-test";
    process.env.OPENAI_API_KEY = "test-key";
    resetSpeakTickets();
    const now = Date.parse("2026-10-02T12:00:00.000Z");
    const line = "That's hot Mocha times 2.";
    const ticket = issueSpeakTicket(line, "session-1", "en", now);
    assert.ok(ticket);
    assert.equal((await claimSpeakTicket(line, ticket, now)).ok, true);
    assert.equal((await claimSpeakTicket(line, ticket, now)).ok, false);
    assert.equal((await claimSpeakTicket("That's hot Latte.", ticket, now)).ok, false);
    const expired = issueSpeakTicket(line, "session-1", "en", now - 120_000);
    assert.ok(expired);
    assert.equal((await claimSpeakTicket(line, expired, now)).ok, false);
  });
});

function restore(value: string | undefined, name: "OPERATOR_PASSWORD" | "OPENAI_API_KEY") {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
