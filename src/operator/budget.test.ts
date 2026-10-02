import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sharedStoreConfigured } from "../persist/remote";
import { claimSpeech, resetSpeechBudget, SPEECH_PER_DAY, SPEECH_PER_IP_PER_HOUR, speechClientIp } from "./budget";

describe("speech budget", () => {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  after(() => {
    restore(previousUrl, "UPSTASH_REDIS_REST_URL");
    restore(previousToken, "UPSTASH_REDIS_REST_TOKEN");
    resetSpeechBudget();
  });

  it("allows a review's worth of calls and then stops that address", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetSpeechBudget();
    const now = Date.parse("2026-10-02T12:00:00.000Z");
    for (let n = 0; n < SPEECH_PER_IP_PER_HOUR; n += 1) {
      assert.equal(await claimSpeech("10.0.0.8", now), true);
    }
    assert.equal(await claimSpeech("10.0.0.8", now), false);
    assert.equal(await claimSpeech("10.0.0.9", now), true);
  });

  it("stops every address once the day is full", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetSpeechBudget();
    const now = Date.parse("2026-10-02T15:00:00.000Z");
    const perAddress = 40;
    let used = 0;
    let address = 1;
    while (used < SPEECH_PER_DAY) {
      const ip = `10.1.0.${address}`;
      const room = Math.min(perAddress, SPEECH_PER_DAY - used);
      for (let n = 0; n < room; n += 1) assert.equal(await claimSpeech(ip, now), true);
      used += room;
      address += 1;
    }
    assert.equal(await claimSpeech("10.9.9.9", now), false);
  });

  it("counts across processes when the shared store is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    assert.equal(sharedStoreConfigured(), true);
    const counts = new Map<string, number>();
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const args = JSON.parse(String(init?.body)) as string[];
      const [op, key] = args;
      if (op === "INCR") {
        const next = (counts.get(key ?? "") ?? 0) + 1;
        counts.set(key ?? "", next);
        return Response.json({ result: next });
      }
      if (op === "EXPIRE") return Response.json({ result: 1 });
      throw new Error(`Unexpected command ${op ?? ""}`);
    };
    try {
      resetSpeechBudget();
      const now = Date.parse("2026-10-02T12:00:00.000Z");
      assert.equal(await claimSpeech("203.0.113.4", now), true);
      counts.set(`futureino:budget:hour:203.0.113.4:${Math.floor(now / 3_600_000) * 3_600_000}`, SPEECH_PER_IP_PER_HOUR);
      assert.equal(await claimSpeech("203.0.113.4", now), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reads the platform address ahead of a caller-supplied forwarded header", () => {
    const request = new Request("https://futureino.example/", {
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-vercel-forwarded-for": "203.0.113.9",
      },
    });
    assert.equal(speechClientIp(request), "203.0.113.9");
  });
});

function restore(value: string | undefined, name: "UPSTASH_REDIS_REST_URL" | "UPSTASH_REDIS_REST_TOKEN") {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
