import { describe, it, expect } from "vitest";
import { errorText } from "./ui";

describe("errorText", () => {
  it("maps wallet rejections", () => {
    expect(errorText({ code: 4001, message: "x" })).toBe("Cancelled in the wallet");
    expect(errorText({ message: "User rejected the request." })).toBe("Cancelled in the wallet");
    expect(errorText({ shortMessage: "The user rejected the request." })).toBe("Cancelled in the wallet");
    expect(errorText({ message: "outer", cause: { code: 4001 } })).toBe("Cancelled in the wallet");
  });

  it("maps chain mismatch", () => {
    expect(errorText({ name: "ChainMismatchError", message: "boom" })).toBe("Switch to ZVM devnet to play");
    expect(errorText({ message: "The current chain of the wallet (id: 1) does not match the target chain" })).toBe("Switch to ZVM devnet to play");
    expect(errorText({ message: "Chain ID mismatch" })).toBe("Switch to ZVM devnet to play");
  });

  it("maps insufficient gas funds", () => {
    expect(errorText({ message: "insufficient funds for gas * price + value" })).toBe("Not enough ZNN to pay for gas");
  });

  const custom: [string, string][] = [
    ["TooEarly", "Too early to settle, wait for the next block"],
    ["AlreadySettled", "This spin was already settled"],
    ["UnknownSpin", "Unknown spin"],
    ["BetTooSmall", "Bet is below the minimum"],
    ["BetTooLarge", "Bet is above the current maximum"],
    ["EnforcedPause", "The machine is paused"],
    ["InsufficientUnlocked", "Not enough unreserved bankroll"],
    ["ERC20InsufficientAllowance", "Approve wZNN first"],
    ["ERC20InsufficientBalance", "Not enough wZNN, wrap more first"],
  ];
  for (const [name, text] of custom) {
    it(`maps ${name}`, () => {
      expect(errorText({ shortMessage: `The contract function reverted with ${name}()`, message: "long" })).toBe(text);
      expect(errorText({ message: "outer", cause: { cause: { message: `reverted: ${name}(1, 2)` } } })).toBe(text);
      expect(errorText({ message: "outer", details: name })).toBe(text);
    });
  }

  it("falls back to shortMessage, message, then String", () => {
    expect(errorText({ shortMessage: "short", message: "long" })).toBe("short");
    expect(errorText({ message: "long" })).toBe("long");
    expect(errorText("plain")).toBe("plain");
  });
});
