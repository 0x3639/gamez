export const SLOT_ABI = [
  { type: "function", name: "placeBet", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ name: "id", type: "uint256" }] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "maxBet", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minBet", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bankroll", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canSettle", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "spins", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "player", type: "address" }, { name: "amount", type: "uint96" }, { name: "targetBlock", type: "uint64" }, { name: "settled", type: "bool" }] },
  { type: "event", name: "SpinPlaced", inputs: [
    { name: "id", type: "uint256", indexed: true }, { name: "player", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false }, { name: "targetBlock", type: "uint256", indexed: false }] },
  { type: "event", name: "SpinSettled", inputs: [
    { name: "id", type: "uint256", indexed: true }, { name: "player", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false }, { name: "r0", type: "uint8", indexed: false },
    { name: "r1", type: "uint8", indexed: false }, { name: "r2", type: "uint8", indexed: false },
    { name: "payout", type: "uint256", indexed: false }] },
  { type: "event", name: "SpinExpired", inputs: [
    { name: "id", type: "uint256", indexed: true }, { name: "player", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false }] },
] as const;

export const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "guy", type: "address" }, { name: "wad", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
