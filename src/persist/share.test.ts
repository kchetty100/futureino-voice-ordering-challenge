import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { forgetLocalRecords, listOperatorSessions, operatorSession } from "../operator/log";
import { forgetLocalSessions, messageSession, openSession } from "../session/store";

const INDEX = "futureino:index";

describe("shared cart", () => {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const values = new Map<string, string>();
  const index = new Set<string>();
  const originalFetch = globalThis.fetch;

  after(() => {
    restore(previousUrl, "UPSTASH_REDIS_REST_URL");
    restore(previousToken, "UPSTASH_REDIS_REST_TOKEN");
    globalThis.fetch = originalFetch;
  });

  it("continues an order after this process forgets it", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    globalThis.fetch = async (_input, init) => {
      const args = JSON.parse(String(init?.body)) as string[];
      return Response.json({ result: run(args) });
    };

    const opened = await openSession("coffee", 1_000);
    const id = opened.session?.id;
    assert.ok(id);
    const drafted = await messageSession(id, "iced latte", 2_000, "text");
    assert.equal(drafted?.session?.lines.length, 1);

    forgetLocalSessions();
    forgetLocalRecords();

    const view = await operatorSession(id);
    assert.equal(view?.transcript[0]?.customer, "iced latte");
    assert.equal(view?.carts.at(-1)?.lines[0]?.name, "Latte");
    const listed = await listOperatorSessions();
    assert.equal(listed.some((session) => session.id === id), true);

    const added = await messageSession(id, "add one more", 3_000, "text");
    assert.equal(added?.session?.lines[0]?.quantity, 2);
    assert.equal(added?.session?.phase, "awaiting_confirmation");
  });

  function run(args: string[]): unknown {
    const [op, key, value] = args;
    if (op === "GET") return values.get(key ?? "") ?? null;
    if (op === "SET") {
      values.set(key ?? "", value ?? "");
      return "OK";
    }
    if (op === "SADD" && key === INDEX && value) {
      index.add(value);
      return 1;
    }
    if (op === "SMEMBERS" && key === INDEX) return [...index];
    if (op === "MGET") return args.slice(1).map((item) => values.get(item) ?? null);
    throw new Error(`Unexpected command ${op ?? ""}`);
  }
});

function restore(value: string | undefined, name: "UPSTASH_REDIS_REST_URL" | "UPSTASH_REDIS_REST_TOKEN") {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
