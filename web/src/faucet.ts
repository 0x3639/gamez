import type { Address } from "viem";
import { FAUCET_URL } from "./config";
import { faucetMessage, formatZnn } from "./logic";

let dripCache: string | null = null;

/** The faucet's current native-ZNN drip per request, formatted, or null if it cannot be read. */
export async function faucetDrip(): Promise<string | null> {
  if (dripCache) return dripCache;
  try {
    const res = await fetch(FAUCET_URL);
    const body = (await res.json()) as { drip?: { l2ZnnWei?: string } };
    const wei = body?.drip?.l2ZnnWei;
    if (!wei || !/^\d+$/.test(wei)) return null;
    dripCache = formatZnn(BigInt(wei));
    return dripCache;
  } catch {
    return null;
  }
}

export async function requestFaucet(address: Address): Promise<string> {
  const drip = await faucetDrip();
  try {
    const res = await fetch(FAUCET_URL, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }),
    });
    const body = await res.json().catch(() => ({}));
    return faucetMessage(res.status, body, drip ?? undefined);
  } catch {
    return faucetMessage(0, null);
  }
}
