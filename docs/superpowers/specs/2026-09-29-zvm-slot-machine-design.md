# ZVM Slot Machine — Design

Date: 2026-09-29
Status: approved in conversation, pending written review

## Purpose

A demo casino slot machine on Zenon's EVM layer (ZVM) devnet. Players connect
MetaMask, bet wrapped ZNN, spin three reels and win or lose. Devnet only: no
real money. It exists to show a working dApp end to end on the ZVM: a verified
Solidity contract, a wallet-connected front end, and a public URL.

Success looks like: a stranger with MetaMask can open gamez.0x3639.com, get
devnet funds from the faucet button, wrap them, spin, and see a settled result
with a link to the transaction on the devnet explorer.

## Network facts (verified 2026-09-29)

| Item | Value |
|---|---|
| Network name | ZVM devnet |
| RPC URL | https://devnet.zenon.foo/zvm/rpc |
| Chain ID | 7340469 (0x7001b5) |
| Native currency | ZNN, 18 decimals |
| Block explorer | https://devnet.zenon.foo/explorer/ |
| Wrapped ZNN (WETH9) | 0x91F5DDA8243e34697C99bE282e05bf48e35A0115 |
| Faucet | POST https://devnet.zenon.foo/zvm/api/faucet `{"address":"0x…"}` → 5 ZNN on the ZVM, 10 s cooldown |
| Block cadence | one block every ~10 s, including empty blocks |
| Base fee | 1,000,000 wei (0.001 gwei); gas limit 300,000,000 |
| Contract verification | POST https://devnet.zenon.foo/zvm/api/verify with `{address, compiler: <solc longVersion>, contract: "contracts/SlotMachine.sol:SlotMachine", input: <solc standard JSON>, constructorArgs: <abi-encoded hex>}` → `{id, status}`; poll GET /zvm/api/verify/{id} until `verified` or `failed`. Builds listed at /zvm/api/verify/compilers (0.8.30–0.8.37 seen). |
| Block randomness | `mixHash` varies per block; `blockhash()` available for the last 256 blocks |

The explorer's "chain 69" is the Network of Momentum base layer, not the EVM
chain id.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Bet token | Wrapped ZNN ERC-20 (the devnet WETH9) | User choice. Contract takes the token address in the constructor so it is token-agnostic. |
| Randomness | Two-step: place bet, settle from a future block hash | User choice. Player cannot bias or withhold; only the block producer could, acceptable on devnet. |
| Deployer | Fresh key generated locally, funded from the faucet | No user key handling. Owner can be transferred later. |
| Hosting | GitHub Pages from the existing empty repo `0x3639/gamez`, custom domain gamez.0x3639.com | User choice. Static site, CNAME + Pages workflow. |
| Repo shape | One repo holds contracts, scripts and `web/`; Pages deploys only the `web/` build | Keeps the contract source next to the address the site uses. Can be split later. |
| Contract tooling | Hardhat + solc from npm | Node 22 present; Foundry not installed. |
| Front end | Vite + TypeScript + viem, no framework | Single page; keeps bundle small and deploys as static files. |

## Contract: `SlotMachine.sol`

Solidity 0.8.x, version pinned to one listed by the devnet verifier. No
external dependencies: a minimal `IERC20` interface and an inline reentrancy
guard. No proxy, no pause.

### State

- `IERC20 public immutable token` — wrapped ZNN.
- `address public owner`.
- `uint256 public minBet` — initial 0.1 tokens (1e17).
- `uint256 public constant MAX_MULTIPLIER = 40`.
- `uint256 public locked` — sum of `amount * MAX_MULTIPLIER` for unsettled spins.
- `uint256 public nextSpinId` — starts at 1.
- `mapping(uint256 => Spin) public spins` where
  `Spin { address player; uint96 amount; uint64 targetBlock; bool settled; }`.

### Player flow

`placeBet(uint256 amount) returns (uint256 id)`

1. `amount >= minBet` and `amount <= maxBet()`.
2. `token.transferFrom(msg.sender, this, amount)` must return true.
3. Record `Spin{player, amount, targetBlock = block.number + 1, settled = false}`.
4. `locked += amount * MAX_MULTIPLIER`.
5. Emit `SpinPlaced(id, player, amount, targetBlock)`.

`settle(uint256 id)` — callable by anyone.

1. Spin exists and is not settled; `block.number > targetBlock`.
2. Mark settled and release the reservation (effects before interactions).
3. `bytes32 h = blockhash(targetBlock)`.
   - If `h == 0` the block is older than 256 blocks: the bet is forfeited.
     Emit `SpinExpired(id, player, amount)` and return. Tokens stay in the
     bankroll.
4. `bytes32 seed = keccak256(abi.encodePacked(h, block.prevrandao, id))`.
5. Reels: `r0 = uint8(seed[0]) % 6`, `r1 = uint8(seed[1]) % 6`, `r2 = uint8(seed[2]) % 6`.
6. `payout = amount * multiplier(r0, r1, r2) / 10` (multipliers stored ×10).
7. If `payout > 0`, `token.transfer(player, payout)` must return true.
8. Emit `SpinSettled(id, player, amount, r0, r1, r2, payout)`.

Reservations use `MAX_MULTIPLIER` (40×) so the bankroll can never owe more than
it holds. Forfeit on expiry is deliberate: a refund would give the player a free
option (see a losing result, wait out 256 blocks, take the bet back).

### Symbols and paytable

Symbol indexes 0–5: 0 cherry, 1 lemon, 2 bell, 3 diamond, 4 seven, 5 Z.

| Result | Multiplier (× bet, returned total) | Combinations of 216 |
|---|---|---|
| Three Z (5,5,5) | 40 | 1 |
| Three sevens (4,4,4) | 20 | 1 |
| Three of any other symbol | 8 | 4 |
| Exactly two matching | 1.3 | 90 |
| No match | 0 | 120 |

Return to player = (40 + 20 + 32 + 117) / 216 = 96.8%.

### Views

- `maxBet()` = `(token.balanceOf(this) - locked) / MAX_MULTIPLIER`; 0 if the
  balance is below `locked`.
- `bankroll()` = `token.balanceOf(this)`.
- `canSettle(id)` = exists, unsettled, `block.number > targetBlock`.

### Owner

- `fund(uint256 amount)` — `transferFrom(owner)` into the bankroll (anyone may
  call; it only adds tokens).
- `withdraw(uint256 amount)` — owner only; `amount <= balance - locked`.
- `setMinBet(uint256)` — owner only.
- `transferOwnership(address)` — owner only, non-zero.

### Events

- `SpinPlaced(uint256 indexed id, address indexed player, uint256 amount, uint256 targetBlock)`
- `SpinSettled(uint256 indexed id, address indexed player, uint256 amount, uint8 r0, uint8 r1, uint8 r2, uint256 payout)`
- `SpinExpired(uint256 indexed id, address indexed player, uint256 amount)`
- `OwnershipTransferred(address indexed from, address indexed to)`

### Errors

Custom errors: `BetTooSmall`, `BetTooLarge`, `TransferFailed`, `UnknownSpin`,
`AlreadySettled`, `TooEarly`, `NotOwner`, `InsufficientUnlocked`, `ZeroAddress`.

### Tests (Hardhat, mocha)

Using a local mock ERC-20 (WETH9-style `deposit()` so the flow mirrors devnet):

- paytable: every three-symbol combination maps to the expected multiplier
  (pure helper exposed for tests).
- place: rejects below min, above max, without allowance; reserves `40×`;
  emits `SpinPlaced` with `targetBlock = n + 1`.
- settle: reverts `TooEarly` at the target block; after mining one more block
  it settles, emits `SpinSettled` with reels in 0–5, pays exactly
  `amount * multiplier / 10`, releases the reservation, and cannot settle twice.
- settle by a third party works.
- expiry: after 257 blocks settle emits `SpinExpired`, pays nothing, releases
  the reservation.
- owner: withdraw is capped by `locked`; non-owner reverts; ownership transfer.

Determinism in tests comes from reading the emitted reels, not predicting
them.

## Front end

One page, `web/`, built with Vite + TypeScript + viem. No framework. Output is
static files for GitHub Pages.

### Config (`web/src/config.ts`)

Chain object for viem and MetaMask (`wallet_addEthereumChain` parameters from
the status page), the slot machine address, the wrapped ZNN address, explorer
base URL, faucet URL. A redeploy is a one-line change.

### Layout

- Header: title, connected address (short), network badge, Connect button.
- Wallet panel: native ZNN balance, wZNN balance, "Get 5 devnet ZNN" (faucet
  POST for the connected address, then refresh balances), "Wrap" input +
  button (`deposit()` on WETH9 with value), "Unwrap" (`withdraw(amount)`).
- Machine: three reels, bet input with min/max shown, Spin button, a status
  line that names the current step.
- Recent spins: last 10 `SpinSettled`/`SpinExpired` events for this player,
  each linking to its transaction on the explorer.
- Footer: contract address linking to the explorer, note that this is devnet
  play money, and the odds table.

### Spin flow

1. If allowance < bet, send `approve(slot, max)` once and wait for the receipt.
2. Send `placeBet(bet)`; on receipt read `id` and `targetBlock` from the
   `SpinPlaced` log. Reels start spinning.
3. Poll block number every 2 s until `block.number > targetBlock`.
4. Send `settle(id)`; on receipt read `SpinSettled` (or `SpinExpired`) and stop
   each reel on its symbol, staggered. Show win amount or "no win".
5. Refresh balances and the recent spins list.

If the tab is reloaded with an unsettled spin, the page finds it from
`SpinPlaced` logs for the player where the spin is still unsettled and offers a
"Settle" button. Every wallet rejection or revert is shown in the status line
in plain words and leaves the machine ready for another spin.

### Wallet handling

`window.ethereum` only (MetaMask or Rabby). On connect, request accounts, then
`wallet_switchEthereumChain`; on error 4902 fall back to
`wallet_addEthereumChain` with the devnet parameters. React to
`accountsChanged` and `chainChanged`. If no injected wallet, show an install
link and disable the machine.

### Visual direction

Handled with the frontend-design skill at implementation time. Constraints:
dark casino cabinet, reels readable at phone width (16 px gutters, no
horizontal scroll), symbols as inline SVG or large glyphs, motion respects
`prefers-reduced-motion`.

## Repository layout

```
gamez/                       # github.com/0x3639/gamez
  contracts/SlotMachine.sol
  contracts/test/MockWETH.sol
  test/SlotMachine.test.ts
  scripts/deploy.ts          # deploy, write address to web/src/deployment.json
  scripts/verify.ts          # POST standard-json to the devnet verify API
  scripts/fund.ts            # faucet loop, wrap, approve, fund bankroll
  hardhat.config.ts
  web/                       # Vite app (index.html, src/, public/CNAME)
  .github/workflows/pages.yml
  docs/superpowers/specs/…
  .env.example               # DEPLOYER_PRIVATE_KEY=
```

`.env` is gitignored. The deployer key never leaves this machine.

## Deployment

1. Generate a deployer key into `.env`.
2. Faucet loop: 12 requests spaced 11 s apart → about 60 ZNN.
3. `hardhat run scripts/deploy.ts --network zvmDevnet` → address written to
   `web/src/deployment.json`.
4. Verify via the explorer API; confirm the address page shows "Verified".
5. `scripts/fund.ts`: wrap 50 ZNN, approve, `fund(50e18)`. Max bet becomes
   1.25 wZNN. The remaining ZNN pays gas.
6. Push to `0x3639/gamez` (already created, empty), enable Pages with the
   GitHub Actions source, set the custom domain; `web/public/CNAME` =
   `gamez.0x3639.com`. The workflow builds `web/` on every push to `main`.
7. User adds DNS: `gamez` CNAME → `0x3639.github.io`.

## Out of scope

Multiple paylines, progressive jackpots, native-ZNN betting, VRF-grade
randomness, mobile wallets via WalletConnect, analytics, mainnet.
