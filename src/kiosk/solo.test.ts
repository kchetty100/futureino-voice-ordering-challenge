import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { otherTabLeads } from "./solo";

describe("one kiosk tab speaks", () => {
  it("lets the newer tab lead", () => {
    assert.equal(otherTabLeads({ tabId: "a", token: 1 }, { tabId: "b", token: 2 }), true);
    assert.equal(otherTabLeads({ tabId: "a", token: 2 }, { tabId: "b", token: 1 }), false);
  });

  it("breaks a tie so both tabs do not go quiet", () => {
    const mine = { tabId: "a", token: 5 };
    const other = { tabId: "b", token: 5 };
    assert.equal(otherTabLeads(mine, other), true);
    assert.equal(otherTabLeads(other, mine), false);
  });
});
