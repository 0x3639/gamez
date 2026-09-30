import { createPublicClient, createWalletClient, custom, http, type Address, type EIP1193Provider } from "viem";
import { ADD_CHAIN_PARAMS, CHAIN_ID, DEVNET, RPC_URL } from "./config";

declare global { interface Window { ethereum?: EIP1193Provider } }

// 1 s polling: viem defaults to 4 s, which adds up to 4 s of lag to every receipt on a 10 s chain.
export const publicClient = createPublicClient({ chain: DEVNET, transport: http(RPC_URL), pollingInterval: 1_000 });

export function getInjected(): EIP1193Provider | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
}

export function walletClient() {
  const p = getInjected();
  if (!p) throw new Error("No wallet found. Install MetaMask or Rabby.");
  return createWalletClient({ chain: DEVNET, transport: custom(p) });
}

export async function connect(): Promise<Address> {
  const p = getInjected();
  if (!p) throw new Error("No wallet found. Install MetaMask or Rabby.");
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as Address[];
  if (!accounts?.length) throw new Error("No account selected");
  return accounts[0];
}

export async function currentAccount(): Promise<Address | null> {
  const p = getInjected();
  if (!p) return null;
  const accounts = (await p.request({ method: "eth_accounts" })) as Address[];
  return accounts?.[0] ?? null;
}

export async function currentChainId(): Promise<number | null> {
  const p = getInjected();
  if (!p) return null;
  const hex = (await p.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

/** Switch the wallet to ZVM devnet, adding it if unknown. Throws a plain-English error if the user declines. */
export async function ensureChain(): Promise<void> {
  const p = getInjected();
  if (!p) throw new Error("No wallet found. Install MetaMask or Rabby.");
  if ((await currentChainId()) === CHAIN_ID) return;
  const hexId = ADD_CHAIN_PARAMS.chainId;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    if (code === 4001) throw new Error("Switch to ZVM devnet to play");
    // 4902 = unknown chain (MetaMask); -32603 seen from some wallets for the same case
    await p.request({ method: "wallet_addEthereumChain", params: [{ ...ADD_CHAIN_PARAMS, rpcUrls: [...ADD_CHAIN_PARAMS.rpcUrls], blockExplorerUrls: [...ADD_CHAIN_PARAMS.blockExplorerUrls] }] }).catch(() => {
      throw new Error("Switch to ZVM devnet to play");
    });
  }
  if ((await currentChainId()) !== CHAIN_ID) throw new Error("Switch to ZVM devnet to play");
}

export function onWalletChange(cb: () => void): void {
  const p = getInjected();
  if (!p) return;
  p.on("accountsChanged", cb);
  p.on("chainChanged", cb);
}
