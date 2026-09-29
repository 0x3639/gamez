import type { Address } from "viem";
import { FAUCET_URL } from "./config";
import { faucetMessage } from "./logic";

export async function requestFaucet(address: Address): Promise<string> {
  try {
    const res = await fetch(FAUCET_URL, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }),
    });
    const body = await res.json().catch(() => ({}));
    return faucetMessage(res.status, body);
  } catch {
    return faucetMessage(0, null);
  }
}
