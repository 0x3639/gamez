import { defineChain } from "viem";
import deployment from "./deployment.json";

export const EXPLORER = "https://devnet.zenon.foo/explorer";
export const RPC_URL = "https://devnet.zenon.foo/zvm/rpc";
export const FAUCET_URL = "https://devnet.zenon.foo/zvm/api/faucet";
export const CHAIN_ID = 7340469;

export const DEVNET = defineChain({
  id: CHAIN_ID,
  name: "ZVM devnet",
  nativeCurrency: { name: "Zenon", symbol: "ZNN", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "ZVM Explorer", url: `${EXPLORER}/` } },
});

export const ADD_CHAIN_PARAMS = {
  chainId: `0x${CHAIN_ID.toString(16)}`,
  chainName: "ZVM devnet",
  nativeCurrency: { name: "Zenon", symbol: "ZNN", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [`${EXPLORER}/`],
} as const;

export const ADDRESSES = {
  slot: deployment.address as `0x${string}`,
  wznn: deployment.token as `0x${string}`,
  deployBlock: BigInt(deployment.deployBlock),
} as const;

export const BLOCK_TIME_MS = 10_000;
