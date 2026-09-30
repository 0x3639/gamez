import { encodePacked, formatUnits, keccak256, parseUnits, type Hex } from "viem";

/** Reel artwork is placeholder meme art (original SVGs in web/public/symbols); swap the files to re-skin. */
export const SYMBOLS = [
  { name: "wojak", label: "Wojak", image: "/symbols/wojak.svg" },
  { name: "pepe", label: "Pepe", image: "/symbols/pepe.svg" },
  { name: "doge", label: "Doge", image: "/symbols/doge.svg" },
  { name: "stonks", label: "Stonks", image: "/symbols/stonks.svg" },
  { name: "chad", label: "Chad", image: "/symbols/chad.svg" },
  { name: "moon", label: "Moon", image: "/symbols/moon.svg" },
] as const;

export const MAX_MULTIPLIER = 40;

/** Mirrors SlotMachine.multiplierX10 for display only; the contract is the source of truth. */
export function multiplierX10(a: number, b: number, c: number): number {
  if (a === b && b === c) return a === 5 ? 400 : a === 4 ? 200 : 80;
  if (a === b || b === c || a === c) return 12;
  return 0;
}

export function formatZnn(wei: bigint, digits = 4): string {
  const unit = 10n ** BigInt(18 - digits);
  const rounded = (wei + unit / 2n) / unit;               // integer in 10^-digits units
  const i = rounded / 10n ** BigInt(digits);
  const f = (rounded % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}

/** Like formatZnn but floors, so a displayed maximum never exceeds the amount the contract accepts. */
export function formatZnnDown(wei: bigint, digits = 4): string {
  const unit = 10n ** BigInt(18 - digits);
  const floored = wei / unit;
  const i = floored / 10n ** BigInt(digits);
  const f = (floored % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}

/** First block to scan for events: max(deployBlock, latest - window). */
export function scanRange(latest: bigint, deployBlock: bigint, window: bigint): bigint {
  const from = latest - window;
  return from > deployBlock ? from : deployBlock;
}

export function parseBet(input: string, min: bigint, max: bigint):
  { ok: true; value: bigint } | { ok: false; message: string } {
  if (max < min) return { ok: false, message: "The machine is out of bankroll right now" };
  const range = `Enter a bet between ${formatZnn(min)} and ${formatZnnDown(max)} wZNN`;
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return { ok: false, message: range };
  const value = parseUnits(t, 18);
  if (value < min || value > max) return { ok: false, message: range };
  return { ok: true, value };
}

export function checkFunds(bet: bigint, wznn: bigint): string | null {
  return wznn >= bet ? null : `You have ${formatZnn(wznn)} wZNN, wrap more first`;
}

/** @param drip the faucet's current drip, already formatted (e.g. "500"); omitted when unknown */
export function faucetMessage(status: number, body: unknown, drip?: string): string {
  const err = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : undefined;
  if (typeof err === "string" && err) return err;
  if (status === 0) return "Faucet unreachable";
  if (status >= 200 && status < 300) return drip ? `Sent ${drip} devnet ZNN to your wallet` : "Sent devnet ZNN to your wallet";
  return `Faucet error (HTTP ${status})`;
}

export function isDevnet(chainId: number | null): boolean {
  return chainId === 7340469;
}

/**
 * Off-chain mirror of SlotMachine.reelsFor: seed = keccak256(blockHash ‖ id),
 * reel i = keccak256(seed ‖ uint8(i)) mod 6. Lets the page reveal a result the
 * moment the target block exists, before the settle transaction is mined.
 */
export function reelsFromHash(blockHash: Hex, id: bigint): [number, number, number] {
  const seed = keccak256(encodePacked(["bytes32", "uint256"], [blockHash, id]));
  const reel = (i: number) => Number(BigInt(keccak256(encodePacked(["bytes32", "uint8"], [seed, i]))) % 6n);
  return [reel(0), reel(1), reel(2)];
}

/** Payout for a bet and reels, exactly as the contract computes it (floor of amount × multiplier). */
export function payoutFor(amount: bigint, reels: [number, number, number]): bigint {
  return (amount * BigInt(multiplierX10(reels[0], reels[1], reels[2]))) / 10n;
}

/** True once a spin's target block is too old for blockhash(); the contract will forfeit it. */
export function isExpired(targetBlock: bigint, currentBlock: bigint): boolean {
  return currentBlock - targetBlock > 256n;
}
