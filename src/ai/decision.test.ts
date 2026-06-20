import { describe, expect, it } from "vitest";
import { parseDecision } from "./decision";

describe("parseDecision", () => {
  it("parses a well-formed RETRY decision", () => {
    const d = parseDecision(
      '{"action":"RETRY","refreshBlockhash":true,"newTipLamports":18398,"waitForLeaderWindow":false,"reasoning":"expired blockhash, refresh and raise tip"}',
    );
    expect(d).toEqual({
      action: "RETRY",
      refreshBlockhash: true,
      newTipLamports: 18398,
      waitForLeaderWindow: false,
      reasoning: "expired blockhash, refresh and raise tip",
    });
  });

  it("normalizes an invented WAIT action into RETRY + waitForLeaderWindow", () => {
    const d = parseDecision(
      '{"action":"WAIT","refreshBlockhash":false,"newTipLamports":4518,"waitForLeaderWindow":true,"reasoning":"hold for the next leader window"}',
    );
    expect(d?.action).toBe("RETRY");
    expect(d?.waitForLeaderWindow).toBe(true);
  });

  it("defaults missing booleans to false", () => {
    const d = parseDecision(
      '{"action":"RETRY","newTipLamports":7101,"reasoning":"raise tip"}',
    );
    expect(d?.refreshBlockhash).toBe(false);
    expect(d?.waitForLeaderWindow).toBe(false);
  });

  it("tolerates prose around the JSON object", () => {
    const d = parseDecision(
      'Decision: {"action":"ABORT","newTipLamports":1000,"reasoning":"compute exceeded, not retryable"} done.',
    );
    expect(d?.action).toBe("ABORT");
  });

  it("returns null on unparseable output", () => {
    expect(parseDecision("no json here")).toBeNull();
    expect(parseDecision('{"action":"RETRY"}')).toBeNull();
  });
});
