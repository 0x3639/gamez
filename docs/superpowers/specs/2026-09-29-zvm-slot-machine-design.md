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

Solidity 0.8.x, version pinned to one listed by the devnet verifier. Built on
audited OpenZeppelin v5 primitives only: `SafeERC20`, `ReentrancyGuard`,
`Ownable2Step`, `Pausable`. No proxy, no delegatecall, no selfdestruct, no
assembly, no `tx.origin`.

### State

- `IERC20 public immutable token` — wrapped ZNN.
- `address public owner`.
- `uint256 public minBet` — initial 0.1 tokens (1e17).
- `uint256 public constant MAX_MULTIPLIER = 40`.
- `uint256 public locked` — sum of `amount * MAX_MULTIPLIER` for unsettled spins.
- `uint256 public maxBetCap` — owner-set absolute ceiling per spin (initial 0.5 tokens), on top of the bankroll-derived limit.
- `uint256 public nextSpinId` — starts at 1.
- `mapping(uint256 => Spin) public spins` where
  `Spin { address player; uint96 amount; uint64 targetBlock; bool settled; }`.

### Player flow

`placeBet(uint256 amount) returns (uint256 id)`

1. Not paused. `amount >= minBet`, `amount <= maxBet()`, `amount <= type(uint96).max`.
2. `SafeERC20.safeTransferFrom(msg.sender, this, amount)`; the amount credited
   is measured as balance-after minus balance-before, and the spin records that
   credited amount (fee-on-transfer safe; a no-op for wZNN).
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
4. `bytes32 seed = keccak256(abi.encodePacked(h, id))`. Nothing from the
   settle block goes into the seed (see Security: settle-block shopping).
5. Reels: `seed = keccak256(abi.encodePacked(h, id))`; for `i` in 0..2,
   `r_i = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(i)))) % 6)`.
   Reducing a 256-bit hash modulo 6 has a bias of about 2^-253, which is
   negligible.
6. `payout = amount * multiplier(r0, r1, r2) / 10` (multipliers stored ×10).
7. If `payout > 0`, `SafeERC20.safeTransfer(player, payout)`.
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
| Exactly two matching | 1.2 | 90 |
| No match | 0 | 120 |

Return to player = (40 + 20 + 32 + 108) / 216 = 92.6%, a 7.4% house edge, in line with a Las Vegas Strip slot.

### Views

- `maxBet()` = `min(maxBetCap, (token.balanceOf(this) - locked) / MAX_MULTIPLIER)`;
  0 if the balance is below `locked`.
- `bankroll()` = `token.balanceOf(this)`.
- `canSettle(id)` = exists, unsettled, `block.number > targetBlock`.

### Owner

- `fund(uint256 amount)` — `transferFrom(owner)` into the bankroll (anyone may
  call; it only adds tokens).
- `withdraw(uint256 amount)` — owner only; `amount <= balance - locked`.
- `setLimits(uint256 minBet, uint256 maxBetCap)` — owner only; `0 < minBet <= maxBetCap`.
- `pause()` / `unpause()` — owner only. Pause blocks `placeBet` only. `settle`
  always works so players are never locked out of a payout.
- Ownership via `Ownable2Step`: the new owner must accept, so a typo cannot
  orphan the contract. Renouncing is disabled.

### Events

- `SpinPlaced(uint256 indexed id, address indexed player, uint256 amount, uint256 targetBlock)`
- `SpinSettled(uint256 indexed id, address indexed player, uint256 amount, uint8 r0, uint8 r1, uint8 r2, uint256 payout)`
- `SpinExpired(uint256 indexed id, address indexed player, uint256 amount)`
- `OwnershipTransferred(address indexed from, address indexed to)`

### Errors

Custom errors: `BetTooSmall`, `BetTooLarge`, `UnknownSpin`, `AlreadySettled`,
`TooEarly`, `InsufficientUnlocked`, `BadLimits`. Access and reentrancy errors
come from the OpenZeppelin bases.

## Security

Threat model: an anonymous, well-funded attacker who can send arbitrary
transactions, deploy contracts, read all state, and simulate any call before
sending it. They are not the block producer. The contract holds the bankroll
and all unsettled bets; the goal is that neither can be taken except through a
fair spin.

| Threat | Mitigation |
|---|---|
| Reentrancy through the token | `nonReentrant` on `placeBet`, `settle`, `withdraw`, `fund`; checks-effects-interactions everywhere; wZNN is a plain WETH9 with no hooks. |
| Settle-block shopping: settler waits for a settle block whose data yields a win | Seed = `keccak256(blockhash(targetBlock), id)` only. The outcome is fixed once the target block exists; when you settle cannot change it. |
| Free option: see a losing result, then avoid the loss | Bet is taken at placement. Not settling forfeits it. Expired spins (target block older than 256) are forfeited, never refunded. |
| Same-block settle: `blockhash(block.number)` is 0 | `settle` requires `block.number > targetBlock`, so 0 can only mean genuine expiry. |
| Target-block choice by the player | `targetBlock` is always `block.number + 1`, not a parameter. |
| Many bets in one block sharing a target block | Each spin id is in the seed, so outcomes differ; each reserves its own 40× liability. |
| Bankroll insolvency / owner rug of live bets | `locked` reserves 40× every open bet at placement; `withdraw` and `maxBet` only see unreserved balance; owner cannot touch reserved funds or any spin. |
| Whale drain via variance | `maxBetCap` absolute ceiling plus the bankroll-derived cap (bankroll/40). |
| Non-standard token behaviour | `SafeERC20` handles missing return values; credited amount measured by balance delta. |
| Arithmetic | Solidity 0.8 checked math; `amount` bounded to `uint96`; multipliers are small constants. |
| Ownership mistakes | `Ownable2Step` accept flow; `renounceOwnership` overridden to revert. |
| Capacity hold: one max bet reserves the whole unreserved bankroll and an attacker delays settling to keep the machine "out of bankroll" | Anyone may settle any spin; the owner runs `npm run settle-open:devnet` (cron-able) to settle every settleable spin; keep the bankroll at least 3 × 40 × the intended max bet. |
| Bug found after launch | `pause` stops new bets only; settlements and payouts keep working. |
| Unbounded loops / storage DoS | No loops over user data; spins are keyed by id. |
| Compiler / toolchain | Pinned solc from the verifier list, optimizer on with fixed runs, source verified on the explorer so the deployed bytecode is auditable. |

Accepted, documented residual risks (devnet):

- The block producer (the ZVM sequencer) could influence the target block's
  hash. No on-chain randomness on this chain resists that; a VRF would be
  needed for real money.
- Anyone may call `settle` for anyone. The payout always goes to the recorded
  player, so this is a convenience, not a risk.

Assurance steps in the plan: unit tests for every path above, a randomized
invariant test (`locked <= balance` and `sum(payouts) <= sum(reserved)` across
thousands of random place/settle/withdraw sequences), Slither static analysis
with zero high/medium findings, and a final read-through against this table.

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
- owner: withdraw is capped by `locked`; non-owner reverts; two-step ownership
  transfer; pause blocks `placeBet` but not `settle`; `setLimits` validation.
- security: reentrant token mock cannot re-enter `settle`/`placeBet`; settling
  in different blocks after the target yields the same reels (no settle-block
  shopping); fee-on-transfer mock credits the received amount.
- invariants: randomized sequences keep `locked <= balance` and never let a
  payout exceed the bankroll.

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
   0.5 wZNN. The remaining ZNN pays gas.
6. Push to `0x3639/gamez` (already created, empty), enable Pages with the
   GitHub Actions source, set the custom domain; `web/public/CNAME` =
   `gamez.0x3639.com`. The workflow builds `web/` on every push to `main`.
7. User adds DNS: `gamez` CNAME → `0x3639.github.io`.

## Out of scope

Multiple paylines, progressive jackpots, native-ZNN betting, VRF-grade
randomness, mobile wallets via WalletConnect, analytics, mainnet.
