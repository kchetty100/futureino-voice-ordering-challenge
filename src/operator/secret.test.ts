import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cookieMatches, operatorToken, passwordMatches, safeNext } from "./secret";

describe("site password", () => {
  it("accepts only the configured password and the matching cookie", () => {
    const previous = process.env.OPERATOR_PASSWORD;
    process.env.OPERATOR_PASSWORD = "counter-review";
    assert.equal(passwordMatches("counter-review"), true);
    assert.equal(passwordMatches("nope"), false);
    assert.equal(cookieMatches(operatorToken() ?? ""), true);
    assert.equal(cookieMatches("not-the-token"), false);
    if (previous === undefined) delete process.env.OPERATOR_PASSWORD;
    else process.env.OPERATOR_PASSWORD = previous;
  });

  it("sends sign-in back to the kiosk or the operator page only", () => {
    assert.equal(safeNext("/"), "/");
    assert.equal(safeNext("/operator/abc"), "/operator/abc");
    assert.equal(safeNext("https://evil.example"), "/");
    assert.equal(safeNext("//evil.example"), "/");
  });
});