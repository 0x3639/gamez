import { formatUnits, parseUnits } from "viem";

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
  if (a === b || b === c || a === c) return 13;
  return 0;
}

export function formatZnn(wei: bigint, digits = 4): string {
  const unit = 10n ** BigInt(18 - digits);
  const rounded = (wei + unit / 2n) / unit;               // integer in 10^-digits units
  const i = rounded / 10n ** BigInt(digits);
  const f = (rounded % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}

export function parseBet(input: string, min: bigint, max: bigint):
  { ok: true; value: bigint } | { ok: false; message: string } {
  if (max < min) return { ok: false, message: "The machine is out of bankroll right now" };
  const range = `Enter a bet between ${formatZnn(min)} and ${formatZnn(max)} wZNN`;
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return { ok: false, message: range };
  const value = parseUnits(t, 18);
  if (value < min || value > max) return { ok: false, message: range };
  return { ok: true, value };
}

export function checkFunds(bet: bigint, wznn: bigint): string | null {
  return wznn >= bet ? null : `You have ${formatZnn(wznn)} wZNN, wrap more first`;
}

export function faucetMessage(status: number, body: unknown): string {
  const err = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : undefined;
  if (typeof err === "string" && err) return err;
  if (status === 0) return "Faucet unreachable";
  if (status >= 200 && status < 300) return "Sent 5 devnet ZNN to your wallet";
  return `Faucet error (HTTP ${status})`;
}

export function isDevnet(chainId: number | null): boolean {
  return chainId === 7340469;
}
