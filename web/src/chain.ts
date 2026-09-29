import { parseEventLogs, type Address, type Hash } from "viem";
import { SLOT_ABI, WETH_ABI } from "./abi";
import { ADDRESSES, BLOCK_TIME_MS } from "./config";
import { publicClient, walletClient } from "./wallet";

export type State = {
  znn: bigint; wznn: bigint; allowance: bigint;
  minBet: bigint; maxBet: bigint; bankroll: bigint; paused: boolean; block: bigint;
};

export type Result = {
  id: bigint; amount: bigint; reels?: [number, number, number]; payout: bigint; expired: boolean; txHash: Hash;
};

const slot = { address: ADDRESSES.slot, abi: SLOT_ABI } as const;
const wznn = { address: ADDRESSES.wznn, abi: WETH_ABI } as const;

export async function readState(player: Address | null): Promise<State> {
  const [minBet, maxBet, bankroll, paused, block] = await Promise.all([
    publicClient.readContract({ ...slot, functionName: "minBet" }),
    publicClient.readContract({ ...slot, functionName: "maxBet" }),
    publicClient.readContract({ ...slot, functionName: "bankroll" }),
    publicClient.readContract({ ...slot, functionName: "paused" }),
    publicClient.getBlockNumber(),
  ]);
  let znn = 0n, wz = 0n, allowance = 0n;
  if (player) {
    [znn, wz, allowance] = await Promise.all([
      publicClient.getBalance({ address: player }),
      publicClient.readContract({ ...wznn, functionName: "balanceOf", args: [player] }),
      publicClient.readContract({ ...wznn, functionName: "allowance", args: [player, ADDRESSES.slot] }),
    ]);
  }
  return { znn, wznn: wz, allowance, minBet, maxBet, bankroll, paused, block };
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

export async function wrap(amount: bigint): Promise<Hash> {
  const a = await account();
  return confirmed(await walletClient().writeContract({ ...wznn, functionName: "deposit", value: amount, account: a }));
}

export async function unwrap(amount: bigint): Promise<Hash> {
  const a = await account();
  return confirmed(await walletClient().writeContract({ ...wznn, functionName: "withdraw", args: [amount], account: a }));
}

export async function approveMax(): Promise<Hash> {
  const a = await account();
  return confirmed(
    await walletClient().writeContract({ ...wznn, functionName: "approve", args: [ADDRESSES.slot, 2n ** 256n - 1n], account: a }),
  );
}

export async function placeBet(amount: bigint): Promise<{ id: bigint; targetBlock: bigint; txHash: Hash }> {
  const a = await account();
  const hash = await walletClient().writeContract({ ...slot, functionName: "placeBet", args: [amount], account: a });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Bet was rejected by the contract");
  const [ev] = parseEventLogs({ abi: SLOT_ABI, eventName: "SpinPlaced", logs: rc.logs });
  if (!ev) throw new Error("No SpinPlaced event in receipt");
  return { id: ev.args.id, targetBlock: ev.args.targetBlock, txHash: hash };
}

export type SettleOutcome =
  | { kind: "settled"; reels: [number, number, number]; payout: bigint; txHash: Hash }
  | { kind: "expired"; txHash: Hash };

export async function settle(id: bigint): Promise<SettleOutcome> {
  const a = await account();
  const hash = await walletClient().writeContract({ ...slot, functionName: "settle", args: [id], account: a });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Settle was rejected by the contract");
  const [s] = parseEventLogs({ abi: SLOT_ABI, eventName: "SpinSettled", logs: rc.logs });
  if (s) return { kind: "settled", reels: [s.args.r0, s.args.r1, s.args.r2], payout: s.args.payout, txHash: hash };
  return { kind: "expired", txHash: hash };
}

/** Resolve once block.number > target. Polls every 2 s; blocks land every ~10 s. */
export async function waitForBlockAfter(target: bigint): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await publicClient.getBlockNumber()) > target) return;
    await new Promise((r) => setTimeout(r, Math.min(2000, BLOCK_TIME_MS)));
  }
  throw new Error("The next block is taking too long; try Settle again in a moment");
}

export async function findOpenSpins(player: Address): Promise<{ id: bigint; amount: bigint; targetBlock: bigint }[]> {
  const logs = await publicClient.getContractEvents({
    ...slot, eventName: "SpinPlaced", args: { player }, fromBlock: ADDRESSES.deployBlock, toBlock: "latest",
  });
  const out: { id: bigint; amount: bigint; targetBlock: bigint }[] = [];
  for (const l of logs.slice(-50)) {
    const s = await publicClient.readContract({ ...slot, functionName: "spins", args: [l.args.id!] });
    if (!s[3]) out.push({ id: l.args.id!, amount: l.args.amount!, targetBlock: l.args.targetBlock! });
  }
  return out;
}

export async function recentResults(player: Address, n = 10): Promise<Result[]> {
  const [settled, expired] = await Promise.all([
    publicClient.getContractEvents({ ...slot, eventName: "SpinSettled", args: { player }, fromBlock: ADDRESSES.deployBlock, toBlock: "latest" }),
    publicClient.getContractEvents({ ...slot, eventName: "SpinExpired", args: { player }, fromBlock: ADDRESSES.deployBlock, toBlock: "latest" }),
  ]);
  const rows: Result[] = [
    ...settled.map((l) => ({ id: l.args.id!, amount: l.args.amount!, reels: [l.args.r0!, l.args.r1!, l.args.r2!] as [number, number, number], payout: l.args.payout!, expired: false, txHash: l.transactionHash })),
    ...expired.map((l) => ({ id: l.args.id!, amount: l.args.amount!, payout: 0n, expired: true, txHash: l.transactionHash })),
  ];
  return rows.sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, n);
}
