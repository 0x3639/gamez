import { parseEventLogs, type Address, type Hash } from "viem";
import { SLOT_ABI } from "./abi";
import { ADDRESSES, BLOCK_TIME_MS, FEES } from "./config";
import { isExpired, payoutFor, reelsFromHash, scanRange } from "./logic";
import { publicClient, walletClient } from "./wallet";

export type State = {
  znn: bigint; owed: bigint;
  minBet: bigint; maxBet: bigint; bankroll: bigint; paused: boolean; block: bigint;
};

export type Result = {
  id: bigint; amount: bigint; reels?: [number, number, number]; payout: bigint; expired: boolean; txHash: Hash;
};

const slot = { address: ADDRESSES.slot, abi: SLOT_ABI } as const;

export async function readState(player: Address | null): Promise<State> {
  const [minBet, maxBet, bankroll, paused, block] = await Promise.all([
    publicClient.readContract({ ...slot, functionName: "minBet" }),
    publicClient.readContract({ ...slot, functionName: "maxBet" }),
    publicClient.readContract({ ...slot, functionName: "bankroll" }),
    publicClient.readContract({ ...slot, functionName: "paused" }),
    publicClient.getBlockNumber(),
  ]);
  let znn = 0n, owed = 0n;
  if (player) {
    [znn, owed] = await Promise.all([
      publicClient.getBalance({ address: player }),
      publicClient.readContract({ ...slot, functionName: "owed", args: [player] }),
    ]);
  }
  return { znn, owed, minBet, maxBet, bankroll, paused, block };
}

async function account(): Promise<Address> {
  const [a] = await walletClient().getAddresses();
  if (!a) throw new Error("Connect a wallet first");
  return a;
}

async function confirmed(hash: Hash): Promise<Hash> {
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Transaction reverted");
  return hash;
}

// Each write is simulated first so a revert surfaces as a decoded custom error before the wallet opens.
export async function placeBet(amount: bigint): Promise<{ id: bigint; targetBlock: bigint; txHash: Hash }> {
  const a = await account();
  const req = { ...slot, functionName: "placeBet", value: amount, account: a } as const;
  await publicClient.simulateContract(req);
  const hash = await walletClient().writeContract({ ...req, ...FEES });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Bet transaction reverted on chain");
  const [ev] = parseEventLogs({ abi: SLOT_ABI, eventName: "SpinPlaced", logs: rc.logs });
  if (!ev) throw new Error("No SpinPlaced event in receipt");
  return { id: ev.args.id, targetBlock: ev.args.targetBlock, txHash: hash };
}

export type SettleOutcome =
  | { kind: "settled"; reels: [number, number, number]; payout: bigint; txHash: Hash }
  | { kind: "expired"; txHash: Hash };

export async function settle(id: bigint): Promise<SettleOutcome> {
  const a = await account();
  const req = { ...slot, functionName: "settle", args: [id], account: a } as const;
  await publicClient.simulateContract(req);
  const hash = await walletClient().writeContract({ ...req, ...FEES });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Settle transaction reverted on chain");
  const [s] = parseEventLogs({ abi: SLOT_ABI, eventName: "SpinSettled", logs: rc.logs });
  if (s) return { kind: "settled", reels: [s.args.r0, s.args.r1, s.args.r2], payout: s.args.payout, txHash: hash };
  return { kind: "expired", txHash: hash };
}

async function waitUntil(ready: (current: bigint) => boolean, onTick?: (current: bigint) => void): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const current = await publicClient.getBlockNumber();
    if (ready(current)) return;
    onTick?.(current);
    await new Promise((r) => setTimeout(r, Math.min(1000, BLOCK_TIME_MS)));
  }
  throw new Error("The next block is taking too long; try Settle again in a moment");
}

/** Pull a payout the contract could not push (only ever needed for contract wallets). */
export async function claimOwed(): Promise<Hash> {
  const a = await account();
  const req = { ...slot, functionName: "withdrawPayout", account: a } as const;
  await publicClient.simulateContract(req);
  const hash = await walletClient().writeContract({ ...req, ...FEES });
  return confirmed(hash);
}

/** Resolve once the target block exists (block.number >= target): enough to reveal the result. */
export function waitForBlock(target: bigint, onTick?: (current: bigint) => void): Promise<void> {
  return waitUntil((current) => current >= target, onTick);
}

/** Resolve once block.number > target: what the contract requires before `settle` can run. */
export function waitForBlockAfter(target: bigint, onTick?: (current: bigint) => void): Promise<void> {
  return waitUntil((current) => current > target, onTick);
}

export type Preview =
  | { kind: "result"; reels: [number, number, number]; payout: bigint }
  | { kind: "expired" };

/**
 * Compute the spin's result off-chain from the target block's hash, exactly as the
 * contract will. Call only after `waitForBlock(targetBlock)`.
 */
export async function previewSpin(id: bigint, amount: bigint, targetBlock: bigint): Promise<Preview> {
  // The settle tx lands at least one block later, and a wallet prompt can add a few more:
  // treat the spin as expired 2 blocks early so a shown win cannot turn into a forfeit.
  const current = await publicClient.getBlockNumber();
  if (isExpired(targetBlock, current + 2n)) return { kind: "expired" };
  const block = await publicClient.getBlock({ blockNumber: targetBlock });
  const reels = reelsFromHash(block.hash, id);
  return { kind: "result", reels, payout: payoutFor(amount, reels) };
}

export async function findOpenSpins(player: Address): Promise<{ id: bigint; amount: bigint; targetBlock: bigint }[]> {
  // Spins older than 256 blocks are forfeit, so a short window is enough (300 blocks ≈ 50 min).
  const fromBlock = scanRange(await publicClient.getBlockNumber(), ADDRESSES.deployBlock, 300n);
  const logs = await publicClient.getContractEvents({
    ...slot, eventName: "SpinPlaced", args: { player }, fromBlock, toBlock: "latest",
  });
  const out: { id: bigint; amount: bigint; targetBlock: bigint }[] = [];
  for (const l of logs.slice(-50)) {
    const s = await publicClient.readContract({ ...slot, functionName: "spins", args: [l.args.id!] });
    if (!s[3]) out.push({ id: l.args.id!, amount: l.args.amount!, targetBlock: l.args.targetBlock! });
  }
  return out;
}

export async function recentResults(player: Address, n = 10): Promise<Result[]> {
  // ~50,000 blocks at 10 s is about six days of history.
  const fromBlock = scanRange(await publicClient.getBlockNumber(), ADDRESSES.deployBlock, 50_000n);
  const [settled, expired] = await Promise.all([
    publicClient.getContractEvents({ ...slot, eventName: "SpinSettled", args: { player }, fromBlock, toBlock: "latest" }),
    publicClient.getContractEvents({ ...slot, eventName: "SpinExpired", args: { player }, fromBlock, toBlock: "latest" }),
  ]);
  const rows: Result[] = [
    ...settled.map((l) => ({ id: l.args.id!, amount: l.args.amount!, reels: [l.args.r0!, l.args.r1!, l.args.r2!] as [number, number, number], payout: l.args.payout!, expired: false, txHash: l.transactionHash })),
    ...expired.map((l) => ({ id: l.args.id!, amount: l.args.amount!, payout: 0n, expired: true, txHash: l.transactionHash })),
  ];
  return rows.sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, n);
}
