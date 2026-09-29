import { describe, it, expect } from "vitest";
import { FEES, CHAIN_ID, DEVNET, ADD_CHAIN_PARAMS } from "./config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("devnet fee policy", () => {
  it("clears the relayer's 50 gwei priority floor with headroom for the base fee", () => {
    expect(FEES.maxPriorityFeePerGas).toBeGreaterThanOrEqual(50_000_000_000n);
    expect(FEES.maxFeePerGas).toBeGreaterThan(FEES.maxPriorityFeePerGas);
    expect(FEES.maxFeePerGas - FEES.maxPriorityFeePerGas).toBeGreaterThanOrEqual(10_000_000n); // ≥ 10× base fee
  });
  it("chain config matches the devnet", () => {
    expect(CHAIN_ID).toBe(7340469);
    expect(DEVNET.id).toBe(7340469);
    expect(ADD_CHAIN_PARAMS.chainId).toBe("0x7001b5");
    expect(ADD_CHAIN_PARAMS.rpcUrls[0]).toBe("https://devnet.zenon.foo/zvm/rpc");
  });
  it("every writeContract in chain.ts carries the fee fields", () => {
    const src = readFileSync(join(__dirname, "chain.ts"), "utf8");
    const writes = (src.match(/writeContract\(/g) ?? []).length;
    const fees = (src.match(/\.\.\.FEES/g) ?? []).length;
    expect(writes).toBeGreaterThan(0);
    expect(fees).toBe(writes);
  });
});
