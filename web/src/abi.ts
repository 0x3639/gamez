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
  { type: "error", name: "BetTooSmall", inputs: [] },
  { type: "error", name: "BetTooLarge", inputs: [] },
  { type: "error", name: "TooEarly", inputs: [] },
  { type: "error", name: "AlreadySettled", inputs: [] },
  { type: "error", name: "UnknownSpin", inputs: [] },
  { type: "error", name: "InsufficientUnlocked", inputs: [] },
  { type: "error", name: "BadLimits", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "RenounceDisabled", inputs: [] },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "ExpectedPause", inputs: [] },
  { type: "error", name: "OwnableUnauthorizedAccount", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "OwnableInvalidOwner", inputs: [{ name: "owner", type: "address" }] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
] as const;

export const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "guy", type: "address" }, { name: "wad", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "error", name: "ERC20InsufficientAllowance", inputs: [{ name: "spender", type: "address" }, { name: "allowance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "ERC20InsufficientBalance", inputs: [{ name: "sender", type: "address" }, { name: "balance", type: "uint256" }, { name: "needed", type: "uint256" }] },
] as const;
