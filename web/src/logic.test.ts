import { describe, it, expect } from "vitest";
import { parseBet, checkFunds, faucetMessage, isDevnet, multiplierX10, formatZnn, SYMBOLS } from "./logic";

const E = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;

describe("parseBet", () => {
  const min = E("0.1"), max = E("2.5");
  it("accepts a plain number within limits", () => {
    expect(parseBet("0.5", min, max)).toEqual({ ok: true, value: E("0.5") });
    expect(parseBet(" 2.5 ", min, max)).toEqual({ ok: true, value: max });
  });
  it("rejects empty, letters, too many decimals, out of range", () => {
    for (const bad of ["", "abc", "1e3", "0.0000000000000000001", "0.09", "2.51", "-1"]) {
      const r = parseBet(bad, min, max);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message).toBe("Enter a bet between 0.1 and 2.5 wZNN");
    }
  });
  it("explains when the machine cannot take any bet", () => {
    const r = parseBet("0.1", min, 0n);
    expect(r).toEqual({ ok: false, message: "The machine is out of bankroll right now" });
  });
});

describe("checkFunds", () => {
  it("null when enough, otherwise says how much you have", () => {
    expect(checkFunds(E("1"), E("1"))).toBeNull();
    expect(checkFunds(E("1"), E("0.25"))).toBe("You have 0.25 wZNN, wrap more first");
  });
});

describe("faucetMessage", () => {
  it("uses the faucet's error field, falls back per status", () => {
    expect(faucetMessage(429, { error: "cooldown: try again in 7s" })).toBe("cooldown: try again in 7s");
    expect(faucetMessage(500, {})).toBe("Faucet error (HTTP 500)");
    expect(faucetMessage(0, null)).toBe("Faucet unreachable");
    expect(faucetMessage(200, { l2Balance: "1" })).toBe("Sent 5 devnet ZNN to your wallet");
  });
});

describe("isDevnet", () => {
  it("only chain 7340469", () => {
    expect(isDevnet(7340469)).toBe(true);
    expect(isDevnet(69)).toBe(false);
    expect(isDevnet(null)).toBe(false);
  });
});

describe("paytable mirror", () => {
  it("matches the contract", () => {
    let total = 0;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) total += multiplierX10(a, b, c);
    expect(total).toBe(2090);
    expect(multiplierX10(5, 5, 5)).toBe(400);
    expect(multiplierX10(4, 4, 4)).toBe(200);
    expect(multiplierX10(0, 0, 0)).toBe(80);
    expect(multiplierX10(1, 2, 1)).toBe(13);
    expect(multiplierX10(0, 1, 2)).toBe(0);
    expect(SYMBOLS).toHaveLength(6);
    expect(SYMBOLS[5].name).toBe("moon");
    for (const s of SYMBOLS) expect(s.image).toMatch(/^\/symbols\/[a-z]+\.svg$/);
  });
});

describe("formatZnn", () => {
  it("trims trailing zeros, max 4 decimals by default", () => {
    expect(formatZnn(E("1.5"))).toBe("1.5");
    expect(formatZnn(E("0.13"))).toBe("0.13");
    expect(formatZnn(123456789012345678n)).toBe("0.1235");
    expect(formatZnn(0n)).toBe("0");
  });
});
