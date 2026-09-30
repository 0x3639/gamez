import { describe, it, expect } from "vitest";
import { parseBet, checkFunds, faucetMessage, isDevnet, multiplierX10, formatZnn, formatZnnDown, scanRange, SYMBOLS, reelsFromHash, payoutFor, isExpired } from "./logic";

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
    expect(faucetMessage(200, { l2Balance: "1" }, "500")).toBe("Sent 500 devnet ZNN to your wallet");
    expect(faucetMessage(200, { l2Balance: "1" })).toBe("Sent devnet ZNN to your wallet");
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
    expect(total).toBe(2000);
    expect(multiplierX10(5, 5, 5)).toBe(400);
    expect(multiplierX10(4, 4, 4)).toBe(200);
    expect(multiplierX10(0, 0, 0)).toBe(80);
    expect(multiplierX10(1, 2, 1)).toBe(12);
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

describe("formatZnnDown", () => {
  it("floors instead of rounding half-up", () => {
    expect(formatZnnDown(1251750000000000000n)).toBe("1.2517");
    expect(formatZnnDown(999990000000000000n)).toBe("0.9999");
    expect(formatZnnDown(10n ** 18n)).toBe("1");
    expect(formatZnnDown(0n)).toBe("0");
    expect(formatZnnDown(1500000000000000000n)).toBe("1.5");
  });
});

describe("parseBet displayed max", () => {
  const min = 10n ** 17n;
  const max = 1251750000000000000n;
  it("never displays a max above what is accepted", () => {
    const r = parseBet("9", min, max);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.endsWith("1.2517 wZNN")).toBe(true);
    expect(parseBet("1.2517", min, max).ok).toBe(true);
  });
});

describe("scanRange", () => {
  it("returns max(deployBlock, latest - window)", () => {
    expect(scanRange(1000n, 100n, 300n)).toBe(700n);
    expect(scanRange(200n, 100n, 300n)).toBe(100n);
    expect(scanRange(400n, 100n, 300n)).toBe(100n);
    expect(scanRange(50n, 100n, 300n)).toBe(100n);
  });
});

describe("reelsFromHash (golden vectors from spins settled on the ZVM devnet)", () => {
  it("matches SpinSettled for spin 1 of 0xe865aF54 (block 62020 → 2 2 5, 0.1 bet paid 0.12)", () => {
    const reels = reelsFromHash("0xd163c174f08ff92a250a38324738a125b193783d03ad01dfec4a3a289c1a6974", 1n);
    expect(reels).toEqual([2, 2, 5]);
    expect(payoutFor(100000000000000000n, reels)).toBe(120000000000000000n);
  });
  it("matches SpinSettled for spin 1 of 0xC5Cc264F (block 61370 → 5 4 0, no win)", () => {
    const reels = reelsFromHash("0x1c80a39790eec86b567d8bf06d3005d08561815956b5b706c0b67f0e00d7222a", 1n);
    expect(reels).toEqual([5, 4, 0]);
    expect(payoutFor(100000000000000000n, reels)).toBe(0n);
  });
  it("floors the payout like the contract", () => {
    expect(payoutFor(1n, [0, 0, 1])).toBe(1n); // 1 * 12 / 10 = 1.2 → 1
    expect(payoutFor(3n, [5, 5, 5])).toBe(120n);
  });
});

describe("isExpired", () => {
  it("flips only after 256 blocks", () => {
    expect(isExpired(100n, 356n)).toBe(false);
    expect(isExpired(100n, 357n)).toBe(true);
  });
});
