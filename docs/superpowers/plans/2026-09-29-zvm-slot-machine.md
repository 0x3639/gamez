# ZVM Slot Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a verified, hardened slot machine contract on the ZVM devnet and a MetaMask-connected static front end at gamez.0x3639.com.

**Architecture:** One repo (`0x3639/gamez`). Hardhat 2 compiles and tests `contracts/SlotMachine.sol` (OpenZeppelin 5 bases, two-step place/settle with a future block hash). Plain JS scripts deploy, verify through the explorer API, and fund the bankroll. `web/` is a framework-free Vite + TypeScript + viem page that GitHub Pages serves.

**Tech Stack:** Node 22, hardhat@2.29, @nomicfoundation/hardhat-toolbox@5 (ethers v6, mocha, chai, network-helpers), @openzeppelin/contracts@5.6, solc 0.8.28 (evmVersion cancun), vite@8, viem@2.57, vitest@5, GitHub Pages via actions.

**Spec:** `docs/superpowers/specs/2026-09-29-zvm-slot-machine-design.md`

## Global Constraints

- Chain: ZVM devnet, chain id `7340469` (`0x7001b5`), RPC `https://devnet.zenon.foo/zvm/rpc`, currency `ZNN` 18 decimals, explorer `https://devnet.zenon.foo/explorer/`.
- Bet token: wrapped ZNN (WETH9) at `0x91F5DDA8243e34697C99bE282e05bf48e35A0115`.
- Faucet: `POST https://devnet.zenon.foo/zvm/api/faucet` body `{"address":"0x…"}`, 5 ZNN per call, 10 s cooldown.
- Verify: `POST https://devnet.zenon.foo/zvm/api/verify` with `{address, compiler, contract, input, constructorArgs}`; poll `GET …/api/verify/{id}`.
- Solidity exactly `0.8.28`, optimizer enabled, 200 runs, evmVersion `cancun`. Only OpenZeppelin 5 imports. No assembly, delegatecall, selfdestruct, `tx.origin`.
- `MAX_MULTIPLIER = 40`; paytable ×10: three Z 400, three sevens 200, other triple 80, any pair 13, else 0. Symbol indexes are fixed by the contract; artwork is a front-end concern. Placeholder art (memes, to be replaced later): 0 wojak, 1 pepe, 2 doge, 3 stonks, 4 chad, 5 moon (jackpot). All artwork is original SVG drawn in this repo; no downloaded or copied images.
- Seed = `keccak256(abi.encodePacked(blockhash(targetBlock), id))`; nothing from the settle block. `targetBlock = block.number + 1`. Expired (`blockhash == 0`) forfeits.
- Initial limits: `minBet = 0.1e18`, `maxBetCap = 5e18`. Bankroll to fund: 50 wZNN.
- `.env` holds `DEPLOYER_PRIVATE_KEY` and is gitignored; the key never appears in chat, logs, or commits.
- Hardhat tests and scripts are CommonJS `.js`. Web code is TypeScript. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Site must work at phone width: 16 px gutters, no horizontal scroll, `prefers-reduced-motion` respected.

## Review Focus

1. **Wallet on another chain when Spin is pressed** — expected: the app switches (or adds) ZVM devnet first, and if the user declines, shows "Switch to ZVM devnet to play" and sends nothing. Pinned in Task 9 (`ensureChain` is awaited inside `spin()` before any write; unit test on the chain guard in Task 8).
2. **Bet typed with too many decimals, letters, or empty** — expected: "Enter a bet between 0.1 and X wZNN", no transaction. Pinned by `parseBet` tests in Task 8.
3. **Page reloaded with a placed-but-unsettled spin** — expected: the machine shows "You have an unsettled spin" with a Settle button, and settling pays. Pinned in Task 9 (`findOpenSpins` from logs) and the devnet smoke test in Task 12.
4. **Faucet refuses (cooldown, empty, network error)** — expected: the exact message from the faucet's JSON `error` field, or "Faucet unreachable", never a silent failure. Pinned by `faucetMessage` tests in Task 8.
5. **Bet larger than wZNN balance or than allowance** — expected: "You have X wZNN, wrap more first" before any wallet prompt; a one-time approve prompt when allowance is short. Pinned by `checkFunds` tests in Task 8 and the approve branch in Task 9.

---

### Task 1: Hardhat project scaffold

**Files:**
- Create: `package.json`, `hardhat.config.js`, `.env.example`, `README.md`
- Modify: `.gitignore` (already has node_modules, .env, dist, artifacts, cache)

**Interfaces:**
- Produces: `npx hardhat test`, `npx hardhat compile`; network name `zvmDevnet`; env var `DEPLOYER_PRIVATE_KEY`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "gamez",
  "version": "0.1.0",
  "private": true,
  "description": "Slot machine on the Zenon ZVM devnet",
  "scripts": {
    "compile": "hardhat compile",
    "test": "hardhat test",
    "deploy:devnet": "hardhat run scripts/deploy.js --network zvmDevnet",
    "verify:devnet": "hardhat run scripts/verify.js --network zvmDevnet",
    "fund:devnet": "hardhat run scripts/fund.js --network zvmDevnet",
    "smoke:devnet": "hardhat run scripts/smoke.js --network zvmDevnet"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "@openzeppelin/contracts": "^5.6.1",
    "dotenv": "^17.2.0",
    "hardhat": "^2.29.1"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `node_modules/` present, no errors. `npx hardhat --version` prints `2.29.x`.

- [ ] **Step 3: Write hardhat.config.js**

```js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const DEVNET_RPC = "https://devnet.zenon.foo/zvm/rpc";
const DEVNET_CHAIN_ID = 7340469;
const key = process.env.DEPLOYER_PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    zvmDevnet: {
      url: DEVNET_RPC,
      chainId: DEVNET_CHAIN_ID,
      accounts: key ? [key] : [],
    },
  },
  mocha: { timeout: 120000 },
};
```

- [ ] **Step 4: Write .env.example and README skeleton**

`.env.example`:
```
# Private key of the devnet deployer / contract owner. Never commit .env.
DEPLOYER_PRIVATE_KEY=
```

`README.md`:
```markdown
# gamez — slot machine on the ZVM devnet

Play at https://gamez.0x3639.com. Devnet only; play money.

- Contract: `contracts/SlotMachine.sol` (Hardhat, Solidity 0.8.28, OpenZeppelin 5)
- Front end: `web/` (Vite + TypeScript + viem), deployed by GitHub Pages
- Network: ZVM devnet, chain id 7340469, RPC https://devnet.zenon.foo/zvm/rpc

## Develop

    npm install && npm test
    cd web && npm install && npm run dev

## Deploy (devnet)

    cp .env.example .env   # add DEPLOYER_PRIVATE_KEY
    npm run deploy:devnet && npm run verify:devnet && npm run fund:devnet
```

- [ ] **Step 5: Verify Hardhat runs with no contracts**

Run: `npx hardhat compile`
Expected: "Nothing to compile" (no contracts yet), exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json hardhat.config.js .env.example README.md
git commit -m "chore: hardhat scaffold for ZVM devnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Test tokens (mock WETH, fee-on-transfer, reentrant)

**Files:**
- Create: `contracts/test/MockWETH.sol`, `contracts/test/FeeToken.sol`, `contracts/test/ReentrantToken.sol`
- Test: `test/mocks.test.js`

**Interfaces:**
- Produces: `MockWETH` (`deposit() payable`, `withdraw(uint)`, `mint(address,uint)`), `FeeToken` (1% burned on every transfer, `mint`), `ReentrantToken` (`mint`, `arm(address target, bytes data)`, `lastReentryOk()`, `reentryAttempts()`). All are ERC-20s with 18 decimals.

- [ ] **Step 1: Write the failing test**

`test/mocks.test.js`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("test tokens", () => {
  it("MockWETH wraps native value 1:1", async () => {
    const [a] = await ethers.getSigners();
    const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
    await weth.deposit({ value: ethers.parseEther("2") });
    expect(await weth.balanceOf(a.address)).to.equal(ethers.parseEther("2"));
    await weth.withdraw(ethers.parseEther("0.5"));
    expect(await weth.balanceOf(a.address)).to.equal(ethers.parseEther("1.5"));
  });

  it("FeeToken burns 1% on transfer", async () => {
    const [a, b] = await ethers.getSigners();
    const fee = await (await ethers.getContractFactory("FeeToken")).deploy();
    await fee.mint(a.address, 1000n);
    await fee.transfer(b.address, 100n);
    expect(await fee.balanceOf(b.address)).to.equal(99n);
  });

  it("ReentrantToken calls its target during transfer and records the result", async () => {
    const [a, b] = await ethers.getSigners();
    const tok = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    await tok.mint(a.address, 10n);
    // arm with a call that must fail: transferring from the zero balance of tok itself
    const data = tok.interface.encodeFunctionData("transfer", [a.address, 1n]);
    await tok.arm(await tok.getAddress(), data);
    await tok.transfer(b.address, 1n);
    expect(await tok.reentryAttempts()).to.equal(1n);
    expect(await tok.lastReentryOk()).to.equal(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx hardhat test test/mocks.test.js`
Expected: FAIL, "HH700: Artifact for contract MockWETH not found".

- [ ] **Step 3: Write the three mocks**

`contracts/test/MockWETH.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test double for the devnet WETH9: wraps native value 1:1 and can mint freely.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped ZNN", "wZNN") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "MockWETH: send failed");
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

`contracts/test/FeeToken.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC-20 that burns 1% of every transfer, to prove the machine credits what it actually receives.
contract FeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
```

`contracts/test/ReentrantToken.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC-20 that, once armed, calls `target` with `data` from inside every transfer,
/// swallowing the result so tests can assert the re-entrant call was rejected.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public data;
    bool public armed;
    bool public lastReentryOk;
    uint256 public reentryAttempts;

    constructor() ERC20("Reentrant Token", "RNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0)) {
            armed = false; // one attempt per transfer, no infinite loops
            reentryAttempts += 1;
            (bool ok, ) = target.call(data);
            lastReentryOk = ok;
            armed = true;
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx hardhat test test/mocks.test.js`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add contracts/test test/mocks.test.js
git commit -m "test: mock WETH, fee-on-transfer and reentrant tokens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: SlotMachine paytable, constructor and views

**Files:**
- Create: `contracts/SlotMachine.sol`
- Test: `test/SlotMachine.paytable.test.js`

**Interfaces:**
- Produces: `SlotMachine(IERC20 token_, address owner_, uint256 minBet_, uint256 maxBetCap_)`; `multiplierX10(uint8,uint8,uint8) pure returns (uint256)`; `reelsFor(bytes32 blockHash, uint256 id) pure returns (uint8,uint8,uint8)`; views `maxBet()`, `bankroll()`, `unlockedBalance()`, `canSettle(uint256)`; constants `MAX_MULTIPLIER=40`, `SYMBOLS=6`, `SYMBOL_SEVEN=4`, `SYMBOL_Z=5`; public `token`, `minBet`, `maxBetCap`, `locked`, `nextSpinId`, `spins(id)`.
- Later tasks add `placeBet`, `settle`, `fund`, `withdraw`, `setLimits`, `pause`, `unpause`.

- [ ] **Step 1: Write the failing test**

`test/SlotMachine.paytable.test.js`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");

async function deploy() {
  const [owner] = await ethers.getSigners();
  const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await weth.getAddress(), owner.address, MIN, CAP);
  return { owner, weth, slot };
}

describe("SlotMachine paytable and views", () => {
  it("maps every reel combination to the spec multiplier", async () => {
    const { slot } = await deploy();
    let total = 0n;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
      const m = await slot.multiplierX10(a, b, c);
      let want;
      if (a === b && b === c) want = a === 5 ? 400n : a === 4 ? 200n : 80n;
      else if (a === b || b === c || a === c) want = 13n;
      else want = 0n;
      expect(m, `${a}${b}${c}`).to.equal(want);
      total += m;
    }
    // RTP = 2090 / (216 * 10) = 96.76%
    expect(total).to.equal(2090n);
  });

  it("derives reels only from the block hash and id, each in 0..5", async () => {
    const { slot } = await deploy();
    const h = ethers.keccak256(ethers.toUtf8Bytes("block"));
    const [r0, r1, r2] = await slot.reelsFor(h, 1n);
    for (const r of [r0, r1, r2]) expect(r).to.be.lessThan(6n);
    const again = await slot.reelsFor(h, 1n);
    expect(again).to.deep.equal([r0, r1, r2]);
    const other = await slot.reelsFor(h, 2n);
    expect(other).to.not.deep.equal([r0, r1, r2]); // ids differ -> outcomes differ (overwhelmingly)
  });

  it("exposes constants and constructor state", async () => {
    const { slot, weth, owner } = await deploy();
    expect(await slot.MAX_MULTIPLIER()).to.equal(40n);
    expect(await slot.SYMBOLS()).to.equal(6n);
    expect(await slot.SYMBOL_SEVEN()).to.equal(4n);
    expect(await slot.SYMBOL_Z()).to.equal(5n);
    expect(await slot.token()).to.equal(await weth.getAddress());
    expect(await slot.owner()).to.equal(owner.address);
    expect(await slot.minBet()).to.equal(MIN);
    expect(await slot.maxBetCap()).to.equal(CAP);
    expect(await slot.nextSpinId()).to.equal(1n);
    expect(await slot.locked()).to.equal(0n);
  });

  it("rejects bad constructor args", async () => {
    const [owner] = await ethers.getSigners();
    const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
    const F = await ethers.getContractFactory("SlotMachine");
    await expect(F.deploy(ethers.ZeroAddress, owner.address, MIN, CAP)).to.be.revertedWithCustomError(F, "ZeroAddress");
    await expect(F.deploy(await weth.getAddress(), owner.address, 0n, CAP)).to.be.revertedWithCustomError(F, "BadLimits");
    await expect(F.deploy(await weth.getAddress(), owner.address, CAP + 1n, CAP)).to.be.revertedWithCustomError(F, "BadLimits");
  });

  it("maxBet is min(cap, unlocked/40) and 0 with an empty bankroll", async () => {
    const { slot, weth } = await deploy();
    expect(await slot.maxBet()).to.equal(0n);
    await weth.mint(await slot.getAddress(), ethers.parseEther("40"));
    expect(await slot.maxBet()).to.equal(ethers.parseEther("1"));
    expect(await slot.bankroll()).to.equal(ethers.parseEther("40"));
    expect(await slot.unlockedBalance()).to.equal(ethers.parseEther("40"));
    await weth.mint(await slot.getAddress(), ethers.parseEther("400"));
    expect(await slot.maxBet()).to.equal(CAP);
  });

  it("canSettle is false for unknown ids", async () => {
    const { slot } = await deploy();
    expect(await slot.canSettle(0n)).to.equal(false);
    expect(await slot.canSettle(1n)).to.equal(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx hardhat test test/SlotMachine.paytable.test.js`
Expected: FAIL, artifact for `SlotMachine` not found.

- [ ] **Step 3: Write the contract (state, paytable, views; no player or owner actions yet)**

`contracts/SlotMachine.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SlotMachine — three-reel slot on the Zenon ZVM devnet, bets in an ERC-20.
/// @notice Two steps per spin: `placeBet` takes the wager and fixes the *next* block as the
///         randomness source; `settle` (anyone, once that block exists) derives the reels from
///         that block's hash and pays out. Nothing from the settle block enters the seed, so
///         choosing when to settle cannot change the result. Not settling forfeits the bet.
/// @dev    Devnet demo. The block producer could in principle influence the target hash; a VRF
///         would be required for real value.
contract SlotMachine is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Spin {
        address player;
        uint96 amount;
        uint64 targetBlock;
        bool settled;
    }

    uint256 public constant MAX_MULTIPLIER = 40; // three Z pays 40x; every bet reserves this
    uint8 public constant SYMBOLS = 6;           // reel symbols 0..5; 4 and 5 are the premium ones, art is a UI concern
    uint8 public constant SYMBOL_SEVEN = 4;
    uint8 public constant SYMBOL_Z = 5;

    IERC20 public immutable token;
    uint256 public minBet;
    uint256 public maxBetCap;
    uint256 public locked;        // sum of amount * MAX_MULTIPLIER over unsettled spins
    uint256 public nextSpinId = 1;
    mapping(uint256 => Spin) public spins;

    event SpinPlaced(uint256 indexed id, address indexed player, uint256 amount, uint256 targetBlock);
    event SpinSettled(uint256 indexed id, address indexed player, uint256 amount, uint8 r0, uint8 r1, uint8 r2, uint256 payout);
    event SpinExpired(uint256 indexed id, address indexed player, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event LimitsSet(uint256 minBet, uint256 maxBetCap);

    error ZeroAddress();
    error BadLimits();
    error BetTooSmall();
    error BetTooLarge();
    error UnknownSpin();
    error AlreadySettled();
    error TooEarly();
    error InsufficientUnlocked();
    error RenounceDisabled();

    constructor(IERC20 token_, address owner_, uint256 minBet_, uint256 maxBetCap_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _setLimits(minBet_, maxBetCap_);
    }

    // ---------------------------------------------------------------- views

    /// @notice Largest bet accepted right now: the owner cap, or what the unreserved bankroll can pay at 40x.
    function maxBet() public view returns (uint256) {
        uint256 unlocked = unlockedBalance();
        uint256 byBankroll = unlocked / MAX_MULTIPLIER;
        return byBankroll < maxBetCap ? byBankroll : maxBetCap;
    }

    function bankroll() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Bankroll not reserved for open spins. Zero if reservations exceed the balance.
    function unlockedBalance() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > locked ? bal - locked : 0;
    }

    function canSettle(uint256 id) external view returns (bool) {
        Spin storage s = spins[id];
        return s.player != address(0) && !s.settled && block.number > s.targetBlock;
    }

    /// @notice Multiplier times ten for a reel combination.
    function multiplierX10(uint8 a, uint8 b, uint8 c) public pure returns (uint256) {
        if (a == b && b == c) {
            if (a == SYMBOL_Z) return 400;
            if (a == SYMBOL_SEVEN) return 200;
            return 80;
        }
        if (a == b || b == c || a == c) return 13;
        return 0;
    }

    /// @notice Reels for a given target block hash and spin id. Pure so anyone can audit a result.
    /// @dev Each reel takes a full 256-bit hash mod 6; modulo bias is ~2^-254, i.e. none in practice.
    function reelsFor(bytes32 blockHash, uint256 id) public pure returns (uint8 r0, uint8 r1, uint8 r2) {
        bytes32 seed = keccak256(abi.encodePacked(blockHash, id));
        r0 = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(0)))) % SYMBOLS);
        r1 = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(1)))) % SYMBOLS);
        r2 = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(2)))) % SYMBOLS);
    }

    // ---------------------------------------------------------------- internal

    function _setLimits(uint256 minBet_, uint256 maxBetCap_) internal {
        if (minBet_ == 0 || minBet_ > maxBetCap_ || maxBetCap_ > type(uint96).max) revert BadLimits();
        minBet = minBet_;
        maxBetCap = maxBetCap_;
        emit LimitsSet(minBet_, maxBetCap_);
    }

    /// @dev Ownership can be transferred (two-step) but never renounced: an ownerless bankroll is stuck.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx hardhat test test/SlotMachine.paytable.test.js`
Expected: 6 passing. Compiler warnings: none.

- [ ] **Step 5: Commit**

```bash
git add contracts/SlotMachine.sol test/SlotMachine.paytable.test.js
git commit -m "feat(contract): SlotMachine paytable, views and constructor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: placeBet

**Files:**
- Modify: `contracts/SlotMachine.sol` (add `placeBet` after the views section)
- Test: `test/SlotMachine.place.test.js`

**Interfaces:**
- Produces: `placeBet(uint256 amount) external returns (uint256 id)`; emits `SpinPlaced(id, player, credited, targetBlock)`.

- [ ] **Step 1: Write the failing test**

`test/SlotMachine.place.test.js`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup(TokenName = "MockWETH") {
  const [owner, alice] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory(TokenName)).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(slotAddr, E(100));          // bankroll -> maxBet = min(5, 2.5) = 2.5
  await tok.mint(alice.address, E(10));
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, tok, slot, slotAddr };
}

describe("SlotMachine.placeBet", () => {
  it("takes the bet, reserves 40x, targets the next block and emits", async () => {
    const { alice, tok, slot, slotAddr } = await setup();
    const tx = await slot.connect(alice).placeBet(E(1));
    const rc = await tx.wait();
    await expect(tx).to.emit(slot, "SpinPlaced").withArgs(1n, alice.address, E(1), BigInt(rc.blockNumber) + 1n);
    expect(await tok.balanceOf(slotAddr)).to.equal(E(101));
    expect(await tok.balanceOf(alice.address)).to.equal(E(9));
    expect(await slot.locked()).to.equal(E(40));
    expect(await slot.nextSpinId()).to.equal(2n);
    const s = await slot.spins(1n);
    expect(s.player).to.equal(alice.address);
    expect(s.amount).to.equal(E(1));
    expect(s.targetBlock).to.equal(BigInt(rc.blockNumber) + 1n);
    expect(s.settled).to.equal(false);
    expect(await slot.canSettle(1n)).to.equal(false); // target block not mined yet
  });

  it("rejects below min, above max, and above the cap", async () => {
    const { alice, slot } = await setup();
    await expect(slot.connect(alice).placeBet(MIN - 1n)).to.be.revertedWithCustomError(slot, "BetTooSmall");
    await expect(slot.connect(alice).placeBet(E(2.5) + 1n)).to.be.revertedWithCustomError(slot, "BetTooLarge");
    await expect(slot.connect(alice).placeBet(E(2.5))).to.not.be.reverted;
  });

  it("reservations shrink maxBet until settled", async () => {
    const { alice, slot } = await setup();
    expect(await slot.maxBet()).to.equal(E(2.5));
    await slot.connect(alice).placeBet(E(2));           // balance 102, locked 80 -> unlocked 22 -> 0.55
    expect(await slot.maxBet()).to.equal(E(0.55));
    await expect(slot.connect(alice).placeBet(E(1))).to.be.revertedWithCustomError(slot, "BetTooLarge");
  });

  it("rejects without allowance or balance", async () => {
    const { owner, alice, tok, slot, slotAddr } = await setup();
    await tok.connect(alice).approve(slotAddr, 0n);
    await expect(slot.connect(alice).placeBet(E(1))).to.be.revertedWithCustomError(tok, "ERC20InsufficientAllowance");
    await tok.connect(owner).approve(slotAddr, ethers.MaxUint256);
    await expect(slot.connect(owner).placeBet(E(1))).to.be.revertedWithCustomError(tok, "ERC20InsufficientBalance");
  });

  it("credits only what actually arrived from a fee-on-transfer token", async () => {
    const { alice, slot } = await setup("FeeToken");
    await slot.connect(alice).placeBet(E(1));
    const s = await slot.spins(1n);
    expect(s.amount).to.equal(E(0.99));
    expect(await slot.locked()).to.equal(E(0.99) * 40n);
  });

  it("is blocked while paused", async () => {
    const { owner, alice, slot } = await setup();
    await slot.connect(owner).pause();
    await expect(slot.connect(alice).placeBet(E(1))).to.be.revertedWithCustomError(slot, "EnforcedPause");
    await slot.connect(owner).unpause();
    await expect(slot.connect(alice).placeBet(E(1))).to.not.be.reverted;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx hardhat test test/SlotMachine.place.test.js`
Expected: FAIL, `slot.connect(...).placeBet is not a function`.

- [ ] **Step 3: Add placeBet and pause/unpause to the contract**

Insert after the views section, before `// ---- internal`:
```solidity
    // ---------------------------------------------------------------- player

    /// @notice Wager `amount` tokens (caller must have approved this contract). The result is
    ///         decided by the hash of the next block; call `settle(id)` once it exists.
    /// @return id The spin id to settle.
    function placeBet(uint256 amount) external nonReentrant whenNotPaused returns (uint256 id) {
        if (amount < minBet) revert BetTooSmall();
        if (amount > maxBet()) revert BetTooLarge();

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 credited = token.balanceOf(address(this)) - before;
        if (credited < minBet) revert BetTooSmall();
        if (credited > amount) revert BetTooLarge(); // never reserve more than was checked against maxBet

        id = nextSpinId++;
        uint64 target = uint64(block.number + 1);
        spins[id] = Spin({player: msg.sender, amount: uint96(credited), targetBlock: target, settled: false});
        locked += credited * MAX_MULTIPLIER;
        emit SpinPlaced(id, msg.sender, credited, target);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Stop new bets (a found bug, a drained bankroll). Settling is never paused.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx hardhat test test/SlotMachine.place.test.js`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add contracts/SlotMachine.sol test/SlotMachine.place.test.js
git commit -m "feat(contract): placeBet with 40x reservation and pause

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: settle (payout, expiry, no settle-block shopping, reentrancy)

**Files:**
- Modify: `contracts/SlotMachine.sol` (add `settle` in the player section)
- Test: `test/SlotMachine.settle.test.js`

**Interfaces:**
- Produces: `settle(uint256 id) external`; emits `SpinSettled(id, player, amount, r0, r1, r2, payout)` or `SpinExpired(id, player, amount)`.

- [ ] **Step 1: Write the failing test**

`test/SlotMachine.settle.test.js`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup(TokenName = "MockWETH") {
  const [owner, alice, bob] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory(TokenName)).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(slotAddr, E(100));
  await tok.mint(alice.address, E(10));
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, bob, tok, slot, slotAddr };
}

async function place(slot, signer, amount) {
  const rc = await (await slot.connect(signer).placeBet(amount)).wait();
  const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === "SpinPlaced");
  return { id: ev.args.id, targetBlock: ev.args.targetBlock };
}

function settledEvent(slot, rc) {
  return rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && (p.name === "SpinSettled" || p.name === "SpinExpired"));
}

describe("SlotMachine.settle", () => {
  it("reverts TooEarly in the placement block and in the target block", async () => {
    const { alice, slot } = await setup();
    // automine: placeBet is block N, target N+1. Disable automine to test the same-block case.
    await ethers.provider.send("evm_setAutomine", [false]);
    const p = slot.connect(alice).placeBet(E(1));
    const s = slot.connect(alice).settle(1n);
    await mine(1);
    await ethers.provider.send("evm_setAutomine", [true]);
    await p;
    await expect(s).to.be.reverted; // same block as placement: TooEarly
    await expect(slot.settle(1n)).to.be.revertedWithCustomError(slot, "TooEarly"); // this tx mines in the target block
    expect(await slot.canSettle(1n)).to.equal(false);
  });

  it("settles after the target block, pays amount*multiplier/10, releases the reservation, emits", async () => {
    const { alice, tok, slot, slotAddr } = await setup();
    const { id, targetBlock } = await place(slot, alice, E(1));
    await mine(1);
    expect(await slot.canSettle(id)).to.equal(true);
    const rc = await (await slot.connect(alice).settle(id)).wait();
    const ev = settledEvent(slot, rc);
    expect(ev.name).to.equal("SpinSettled");
    const { r0, r1, r2, payout } = ev.args;
    const want = E(1) * (await slot.multiplierX10(r0, r1, r2)) / 10n;
    expect(payout).to.equal(want);
    // reels match the pure function applied to the real target block hash
    const blk = await ethers.provider.getBlock(Number(targetBlock));
    const reels = await slot.reelsFor(blk.hash, id);
    expect([r0, r1, r2]).to.deep.equal([...reels]);
    expect(await tok.balanceOf(alice.address)).to.equal(E(9) + payout);
    expect(await tok.balanceOf(slotAddr)).to.equal(E(101) - payout);
    expect(await slot.locked()).to.equal(0n);
    expect((await slot.spins(id)).settled).to.equal(true);
    await expect(slot.settle(id)).to.be.revertedWithCustomError(slot, "AlreadySettled");
  });

  it("can be settled by anyone; payout still goes to the player", async () => {
    const { alice, bob, tok, slot } = await setup();
    const { id } = await place(slot, alice, E(1));
    await mine(1);
    const rc = await (await slot.connect(bob).settle(id)).wait();
    const { payout } = settledEvent(slot, rc).args;
    expect(await tok.balanceOf(alice.address)).to.equal(E(9) + payout);
    expect(await tok.balanceOf(bob.address)).to.equal(0n);
  });

  it("gives the same reels whichever later block settles it (no settle-block shopping)", async () => {
    const { alice, slot } = await setup();
    const { id, targetBlock } = await place(slot, alice, E(1));
    await mine(1);
    const early = await slot.settle.staticCall(id);          // simulate now
    const blk = await ethers.provider.getBlock(Number(targetBlock));
    const expected = await slot.reelsFor(blk.hash, id);
    await mine(50);
    const rc = await (await slot.settle(id)).wait();
    const { r0, r1, r2 } = settledEvent(slot, rc).args;
    expect([r0, r1, r2]).to.deep.equal([...expected]);
    void early;
  });

  it("forfeits an expired spin (target older than 256 blocks) and releases the reservation", async () => {
    const { alice, tok, slot, slotAddr } = await setup();
    const { id } = await place(slot, alice, E(1));
    await mine(257);
    await expect(slot.settle(id)).to.emit(slot, "SpinExpired").withArgs(id, alice.address, E(1));
    expect(await tok.balanceOf(alice.address)).to.equal(E(9));
    expect(await tok.balanceOf(slotAddr)).to.equal(E(101));
    expect(await slot.locked()).to.equal(0n);
    expect((await slot.spins(id)).settled).to.equal(true);
  });

  it("rejects unknown ids", async () => {
    const { slot } = await setup();
    await expect(slot.settle(0n)).to.be.revertedWithCustomError(slot, "UnknownSpin");
    await expect(slot.settle(99n)).to.be.revertedWithCustomError(slot, "UnknownSpin");
  });

  it("still settles while paused", async () => {
    const { owner, alice, slot } = await setup();
    const { id } = await place(slot, alice, E(1));
    await slot.connect(owner).pause();
    await mine(1);
    await expect(slot.settle(id)).to.emit(slot, "SpinSettled");
  });

  it("many spins in one block get independent outcomes and reservations", async () => {
    const { alice, slot } = await setup();
    await ethers.provider.send("evm_setAutomine", [false]);
    const txs = [];
    for (let i = 0; i < 5; i++) txs.push(slot.connect(alice).placeBet(E(0.5)));
    await mine(1);
    await ethers.provider.send("evm_setAutomine", [true]);
    await Promise.all(txs);
    expect(await slot.locked()).to.equal(E(0.5) * 40n * 5n);
    await mine(1);
    const seen = new Set();
    for (let id = 1n; id <= 5n; id++) {
      const rc = await (await slot.settle(id)).wait();
      const { r0, r1, r2 } = settledEvent(slot, rc).args;
      seen.add(`${r0}${r1}${r2}`);
    }
    expect(seen.size).to.be.greaterThan(1);
    expect(await slot.locked()).to.equal(0n);
  });

  it("blocks re-entrant settle and placeBet from inside the payout transfer", async () => {
    const { owner, alice, tok, slot, slotAddr } = await setup("ReentrantToken");
    // Force a winning spin so a payout transfer happens: try ids until one pays.
    let id, targetBlock;
    for (let i = 0; i < 40; i++) {
      ({ id, targetBlock } = await place(slot, alice, E(0.1)));
      await mine(1);
      const blk = await ethers.provider.getBlock(Number(targetBlock));
      const [a, b, c] = await slot.reelsFor(blk.hash, id);
      if ((await slot.multiplierX10(a, b, c)) > 0n) break;
      await slot.settle(id);
    }
    await tok.arm(slotAddr, slot.interface.encodeFunctionData("settle", [id]));
    await expect(slot.settle(id)).to.emit(slot, "SpinSettled");
    expect(await tok.reentryAttempts()).to.equal(1n);
    expect(await tok.lastReentryOk()).to.equal(false);

    // and placeBet re-entered from inside placeBet's own transferFrom
    await tok.arm(slotAddr, slot.interface.encodeFunctionData("placeBet", [E(0.1)]));
    const before = await slot.nextSpinId();
    await slot.connect(alice).placeBet(E(0.1));
    expect(await slot.nextSpinId()).to.equal(before + 1n); // exactly one spin created
    expect(await tok.lastReentryOk()).to.equal(false);
    void owner;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx hardhat test test/SlotMachine.settle.test.js`
Expected: FAIL, `slot.settle is not a function` (and the first test's `slot.connect(alice).settle` rejection).

- [ ] **Step 3: Add settle to the contract (player section, after placeBet)**

```solidity
    /// @notice Resolve spin `id` once its target block exists. Anyone may call; the payout always
    ///         goes to the recorded player. If the target block is older than 256 blocks its hash
    ///         is unavailable and the bet is forfeited (a refund would be a free option).
    function settle(uint256 id) external nonReentrant {
        Spin storage s = spins[id];
        address player = s.player;
        if (player == address(0)) revert UnknownSpin();
        if (s.settled) revert AlreadySettled();
        if (block.number <= s.targetBlock) revert TooEarly();

        s.settled = true;
        uint256 amount = s.amount;
        locked -= amount * MAX_MULTIPLIER;

        bytes32 h = blockhash(s.targetBlock);
        if (h == bytes32(0)) {
            emit SpinExpired(id, player, amount);
            return;
        }

        (uint8 r0, uint8 r1, uint8 r2) = reelsFor(h, id);
        uint256 payout = (amount * multiplierX10(r0, r1, r2)) / 10;
        emit SpinSettled(id, player, amount, r0, r1, r2, payout);
        if (payout > 0) token.safeTransfer(player, payout);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx hardhat test test/SlotMachine.settle.test.js`
Expected: 9 passing. If the same-block test's first `expect(s).to.be.reverted` is flaky because Hardhat orders the two pending txs differently, replace that assertion with `await expect(s).to.be.revertedWithCustomError(slot, "TooEarly")` after confirming the ordering with `rc.index`; both orders must revert `TooEarly` because `block.number == targetBlock - 1` or `== targetBlock`.

- [ ] **Step 5: Commit**

```bash
git add contracts/SlotMachine.sol test/SlotMachine.settle.test.js
git commit -m "feat(contract): settle with forfeit-on-expiry and fixed-seed reels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Owner functions, invariants, static analysis

**Files:**
- Modify: `contracts/SlotMachine.sol` (owner section)
- Test: `test/SlotMachine.owner.test.js`, `test/SlotMachine.invariants.test.js`

**Interfaces:**
- Produces: `fund(uint256)`, `withdraw(uint256) onlyOwner`, `setLimits(uint256,uint256) onlyOwner`; `transferOwnership`/`acceptOwnership` from Ownable2Step.

- [ ] **Step 1: Write the failing owner test**

`test/SlotMachine.owner.test.js`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup() {
  const [owner, alice, bob] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory("MockWETH")).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(owner.address, E(100));
  await tok.mint(alice.address, E(10));
  await tok.connect(owner).approve(slotAddr, ethers.MaxUint256);
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, bob, tok, slot, slotAddr };
}

describe("SlotMachine owner functions", () => {
  it("fund moves tokens in from anyone and emits", async () => {
    const { owner, alice, tok, slot, slotAddr } = await setup();
    await expect(slot.connect(owner).fund(E(50))).to.emit(slot, "Funded").withArgs(owner.address, E(50));
    await expect(slot.connect(alice).fund(E(1))).to.emit(slot, "Funded").withArgs(alice.address, E(1));
    expect(await tok.balanceOf(slotAddr)).to.equal(E(51));
  });

  it("withdraw is owner-only and capped by the unlocked balance", async () => {
    const { owner, alice, tok, slot } = await setup();
    await slot.connect(owner).fund(E(50));
    await slot.connect(alice).placeBet(E(1));                       // locked 40, balance 51
    await expect(slot.connect(alice).withdraw(E(1))).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
    await expect(slot.connect(owner).withdraw(E(11) + 1n)).to.be.revertedWithCustomError(slot, "InsufficientUnlocked");
    await expect(slot.connect(owner).withdraw(E(11))).to.emit(slot, "Withdrawn").withArgs(owner.address, E(11));
    expect(await tok.balanceOf(owner.address)).to.equal(E(61));
    await mine(1);
    await slot.settle(1n);
    expect(await slot.locked()).to.equal(0n);
  });

  it("setLimits validates and emits", async () => {
    const { owner, alice, slot } = await setup();
    await expect(slot.connect(alice).setLimits(E(1), E(2))).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
    await expect(slot.connect(owner).setLimits(0n, E(2))).to.be.revertedWithCustomError(slot, "BadLimits");
    await expect(slot.connect(owner).setLimits(E(3), E(2))).to.be.revertedWithCustomError(slot, "BadLimits");
    await expect(slot.connect(owner).setLimits(E(1), 2n ** 96n)).to.be.revertedWithCustomError(slot, "BadLimits");
    await expect(slot.connect(owner).setLimits(E(1), E(2))).to.emit(slot, "LimitsSet").withArgs(E(1), E(2));
    expect(await slot.minBet()).to.equal(E(1));
    expect(await slot.maxBetCap()).to.equal(E(2));
  });

  it("ownership is two-step and cannot be renounced", async () => {
    const { owner, bob, slot } = await setup();
    await slot.connect(owner).transferOwnership(bob.address);
    expect(await slot.owner()).to.equal(owner.address);
    expect(await slot.pendingOwner()).to.equal(bob.address);
    await slot.connect(bob).acceptOwnership();
    expect(await slot.owner()).to.equal(bob.address);
    await expect(slot.connect(bob).renounceOwnership()).to.be.revertedWithCustomError(slot, "RenounceDisabled");
    await expect(slot.connect(owner).pause()).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx hardhat test test/SlotMachine.owner.test.js`
Expected: FAIL, `slot.connect(...).fund is not a function`.

- [ ] **Step 3: Add fund, withdraw, setLimits to the owner section**

```solidity
    /// @notice Add to the bankroll. Anyone may top it up.
    function fund(uint256 amount) external nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Withdraw bankroll that is not reserved for open spins.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount > unlockedBalance()) revert InsufficientUnlocked();
        emit Withdrawn(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    function setLimits(uint256 minBet_, uint256 maxBetCap_) external onlyOwner {
        _setLimits(minBet_, maxBetCap_);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx hardhat test test/SlotMachine.owner.test.js`
Expected: 4 passing.

- [ ] **Step 5: Write the randomized invariant test**

`test/SlotMachine.invariants.test.js`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseEther(String(n));

// Deterministic PRNG so a failure is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe("SlotMachine invariants (randomized)", () => {
  it("locked <= balance, payouts <= 40x, reservations always released", async function () {
    this.timeout(600000);
    const rand = rng(20260929);
    const [owner, ...players] = (await ethers.getSigners()).slice(0, 5);
    const tok = await (await ethers.getContractFactory("MockWETH")).deploy();
    const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
      await tok.getAddress(), owner.address, E(0.1), E(5));
    const slotAddr = await slot.getAddress();
    await tok.mint(owner.address, E(1000));
    await tok.connect(owner).approve(slotAddr, ethers.MaxUint256);
    await slot.connect(owner).fund(E(200));
    for (const p of players) {
      await tok.mint(p.address, E(100));
      await tok.connect(p).approve(slotAddr, ethers.MaxUint256);
    }

    const open = [];
    let totalPaid = 0n, totalBet = 0n;
    for (let step = 0; step < 300; step++) {
      const r = rand();
      if (r < 0.5) {
        const p = players[Math.floor(rand() * players.length)];
        const max = await slot.maxBet();
        if (max >= E(0.1)) {
          const amt = E(0.1) + BigInt(Math.floor(rand() * Number((max - E(0.1)) / 10n ** 15n))) * 10n ** 15n;
          const rc = await (await slot.connect(p).placeBet(amt)).wait();
          const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
            .find((x) => x && x.name === "SpinPlaced");
          open.push({ id: ev.args.id, amount: ev.args.amount });
          totalBet += ev.args.amount;
        }
      } else if (r < 0.85 && open.length) {
        const i = Math.floor(rand() * open.length);
        const { id, amount } = open.splice(i, 1)[0];
        if (!(await slot.canSettle(id))) await mine(1);
        const rc = await (await slot.settle(id)).wait();
        const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
          .find((x) => x && (x.name === "SpinSettled" || x.name === "SpinExpired"));
        if (ev.name === "SpinSettled") {
          expect(ev.args.payout).to.be.at.most(amount * 40n);
          totalPaid += ev.args.payout;
        }
      } else if (r < 0.95) {
        const unlocked = await slot.unlockedBalance();
        if (unlocked > 0n) await slot.connect(owner).withdraw(unlocked / 3n);
      } else {
        await slot.connect(owner).fund(E(10));
      }
      const bal = await tok.balanceOf(slotAddr);
      expect(await slot.locked()).to.be.at.most(bal);
      expect(await slot.unlockedBalance()).to.equal(bal - (await slot.locked()));
    }
    for (const { id } of open) {
      if (!(await slot.canSettle(id))) await mine(1);
      await slot.settle(id);
    }
    expect(await slot.locked()).to.equal(0n);
    expect(totalPaid).to.be.at.most(totalBet * 40n);
  });
});
```

- [ ] **Step 6: Run the whole suite**

Run: `npx hardhat test`
Expected: all passing (mocks 3, paytable 6, place 6, settle 9, owner 4, invariants 1 = 29).

- [ ] **Step 7: Static analysis with Slither**

Run: `command -v slither || (command -v pipx && pipx install slither-analyzer) || python3 -m pip install --user slither-analyzer`
Then: `slither . --filter-paths "node_modules|contracts/test" --exclude-informational --exclude-low`
Expected: no High or Medium findings. Known acceptable notes if they appear: `block.number`/`blockhash` "weak PRNG" is the documented design (see spec Security); "reentrancy-benign" on the `emit` after `s.settled = true` is a false positive because state is finalized before the transfer. Anything else: fix the contract, rerun the tests, and record it in the commit message.
If Slither cannot be installed (no pip/pipx), record that in the commit message and move on; the reentrancy and ordering properties are covered by tests.

- [ ] **Step 8: Final contract read-through against the spec's Security table**

Open `contracts/SlotMachine.sol` and tick each row of the spec's threat table against a line of code. Confirm: no `block.prevrandao`, `block.timestamp`, `tx.origin`, `selfdestruct`, `delegatecall`, `assembly` anywhere (`grep -nE "prevrandao|timestamp|tx.origin|selfdestruct|delegatecall|assembly" contracts/SlotMachine.sol` prints nothing).

- [ ] **Step 9: Commit**

```bash
git add contracts/SlotMachine.sol test/SlotMachine.owner.test.js test/SlotMachine.invariants.test.js
git commit -m "feat(contract): owner controls, randomized invariants, slither clean

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Deploy, verify, faucet/fund and smoke scripts

**Files:**
- Create: `scripts/lib/devnet.js`, `scripts/deploy.js`, `scripts/verify.js`, `scripts/fund.js`, `scripts/smoke.js`, `scripts/new-key.js`
- Create: `web/src/deployment.json` (written by deploy; committed)

**Interfaces:**
- Consumes: `SlotMachine` constructor `(token, owner, minBet, maxBetCap)`; `fund`, `placeBet`, `settle`, `canSettle`, `maxBet`.
- Produces: `web/src/deployment.json` `{ "chainId": 7340469, "address": "0x…", "token": "0x…", "deployBlock": N, "constructorArgs": "0x…", "txHash": "0x…" }` read by the web app.

- [ ] **Step 1: Shared devnet helpers**

`scripts/lib/devnet.js`:
```js
const fs = require("fs");
const path = require("path");

const DEVNET = {
  chainId: 7340469,
  rpc: "https://devnet.zenon.foo/zvm/rpc",
  explorer: "https://devnet.zenon.foo/explorer",
  api: "https://devnet.zenon.foo/zvm/api",
  wrappedZnn: "0x91F5DDA8243e34697C99bE282e05bf48e35A0115",
  minBet: 10n ** 17n,          // 0.1
  maxBetCap: 5n * 10n ** 18n,  // 5
};

const DEPLOYMENT_FILE = path.join(__dirname, "..", "..", "web", "src", "deployment.json");

function readDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error("web/src/deployment.json missing: run deploy first");
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function writeDeployment(d) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");
}

async function faucet(address) {
  const res = await fetch(`${DEVNET.api}/faucet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `faucet HTTP ${res.status}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

module.exports = { DEVNET, DEPLOYMENT_FILE, readDeployment, writeDeployment, faucet, sleep, WETH_ABI };
```

- [ ] **Step 2: Key generator (prints only the address)**

`scripts/new-key.js`:
```js
// Generates a deployer key into .env if none exists. Prints the address only.
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const envPath = path.join(__dirname, "..", ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^DEPLOYER_PRIVATE_KEY=0x[0-9a-fA-F]{64}/m.test(existing)) {
  const key = existing.match(/^DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1];
  console.log("existing deployer:", new Wallet(key).address);
  process.exit(0);
}
const w = Wallet.createRandom();
fs.writeFileSync(envPath, `${existing.trim()}\nDEPLOYER_PRIVATE_KEY=${w.privateKey}\n`.trimStart(), { mode: 0o600 });
console.log("new deployer:", w.address);
```

- [ ] **Step 3: Deploy script**

`scripts/deploy.js`:
```js
const { ethers, network } = require("hardhat");
const { DEVNET, writeDeployment } = require("./lib/devnet");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY not set in .env");
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network ${network.name} chain ${(await ethers.provider.getNetwork()).chainId}`);
  console.log(`deployer ${deployer.address} balance ${ethers.formatEther(bal)} ZNN`);
  if (bal < ethers.parseEther("0.5")) throw new Error("deployer needs at least 0.5 ZNN for gas; run fund.js --faucet-only first");

  const F = await ethers.getContractFactory("SlotMachine");
  const args = [DEVNET.wrappedZnn, deployer.address, DEVNET.minBet, DEVNET.maxBetCap];
  const slot = await F.deploy(...args);
  const tx = slot.deploymentTransaction();
  console.log(`deploy tx ${tx.hash}`);
  const rc = await tx.wait(1);
  const address = await slot.getAddress();
  const constructorArgs = F.interface.encodeDeploy(args);
  writeDeployment({
    chainId: DEVNET.chainId, address, token: DEVNET.wrappedZnn, owner: deployer.address,
    deployBlock: rc.blockNumber, constructorArgs, txHash: tx.hash,
  });
  console.log(`SlotMachine at ${address} (block ${rc.blockNumber})`);
  console.log(`${DEVNET.explorer}/address/${address}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Verify script (explorer API, standard JSON from Hardhat build-info)**

`scripts/verify.js`:
```js
const fs = require("fs");
const path = require("path");
const { DEVNET, readDeployment, sleep } = require("./lib/devnet");

function latestBuildInfo() {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error("no build-info: run npx hardhat compile");
  return JSON.parse(fs.readFileSync(path.join(dir, files[0].f), "utf8"));
}

async function main() {
  const d = readDeployment();
  const info = latestBuildInfo();
  const compilers = await (await fetch(`${DEVNET.api}/verify/compilers`)).json();
  const build = compilers.builds.find((b) => b.version === info.solcVersion && !b.longVersion.includes("pre"));
  if (!build) throw new Error(`verifier has no solc ${info.solcVersion}`);
  // Only send the sources the contract needs (SlotMachine + its OpenZeppelin imports).
  const input = { ...info.input, sources: Object.fromEntries(
    Object.entries(info.input.sources).filter(([p]) => !p.startsWith("contracts/test/"))) };
  const body = {
    address: d.address,
    compiler: build.longVersion,
    contract: "contracts/SlotMachine.sol:SlotMachine",
    input,
    constructorArgs: d.constructorArgs,
  };
  const res = await fetch(`${DEVNET.api}/verify`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const job = await res.json();
  if (!res.ok || job.error) throw new Error(job.error || `verify HTTP ${res.status}: ${JSON.stringify(job)}`);
  console.log("verify job", job.id, job.status);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = await (await fetch(`${DEVNET.api}/verify/${job.id}`)).json();
    if (st.status === "verified") { console.log("verified:", `${DEVNET.explorer}/address/${d.address}`); return; }
    if (st.status === "failed") throw new Error(`verification failed: ${JSON.stringify(st)}`);
    process.stdout.write(".");
  }
  throw new Error("verification timed out");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Fund script (faucet loop → wrap → approve → fund)**

`scripts/fund.js`:
```js
// Usage: npx hardhat run scripts/fund.js --network zvmDevnet
//   env FAUCET_REQUESTS=12  (5 ZNN each)   env BANKROLL=50  (wZNN to fund)   env FAUCET_ONLY=1
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, faucet, sleep, WETH_ABI } = require("./lib/devnet");

async function main() {
  const [deployer] = await ethers.getSigners();
  const requests = Number(process.env.FAUCET_REQUESTS ?? 12);
  const bankroll = ethers.parseEther(process.env.BANKROLL ?? "50");

  for (let i = 0; i < requests; i++) {
    try {
      const r = await faucet(deployer.address);
      console.log(`faucet ${i + 1}/${requests}: ok (served ${r.served ?? "?"})`);
    } catch (e) {
      console.log(`faucet ${i + 1}/${requests}: ${e.message}`);
    }
    if (i < requests - 1) await sleep(11000);
  }
  await sleep(12000); // let the last drip land
  console.log(`balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ZNN`);
  if (process.env.FAUCET_ONLY) return;

  const d = readDeployment();
  const weth = new ethers.Contract(DEVNET.wrappedZnn, WETH_ABI, deployer);
  const slot = await ethers.getContractAt("SlotMachine", d.address, deployer);

  console.log(`wrapping ${ethers.formatEther(bankroll)} ZNN`);
  await (await weth.deposit({ value: bankroll })).wait(1);
  if ((await weth.allowance(deployer.address, d.address)) < bankroll) {
    await (await weth.approve(d.address, ethers.MaxUint256)).wait(1);
  }
  await (await slot.fund(bankroll)).wait(1);
  console.log(`bankroll ${ethers.formatEther(await slot.bankroll())} wZNN, maxBet ${ethers.formatEther(await slot.maxBet())} wZNN`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Smoke script (one real spin on devnet)**

`scripts/smoke.js`:
```js
// Places one 0.1 wZNN bet from the deployer, waits for the target block, settles, prints reels.
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, sleep, WETH_ABI } = require("./lib/devnet");

async function main() {
  const [signer] = await ethers.getSigners();
  const d = readDeployment();
  const weth = new ethers.Contract(DEVNET.wrappedZnn, WETH_ABI, signer);
  const slot = await ethers.getContractAt("SlotMachine", d.address, signer);
  const bet = ethers.parseEther("0.1");
  if ((await weth.balanceOf(signer.address)) < bet) await (await weth.deposit({ value: bet })).wait(1);
  if ((await weth.allowance(signer.address, d.address)) < bet) await (await weth.approve(d.address, ethers.MaxUint256)).wait(1);

  const rc = await (await slot.placeBet(bet)).wait(1);
  const placed = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === "SpinPlaced");
  const id = placed.args.id, target = Number(placed.args.targetBlock);
  console.log(`placed spin ${id} in block ${rc.blockNumber}, target ${target}: ${DEVNET.explorer}/tx/${rc.hash}`);
  while ((await ethers.provider.getBlockNumber()) <= target) { await sleep(2000); process.stdout.write("."); }
  console.log();
  const rc2 = await (await slot.settle(id)).wait(1);
  const ev = rc2.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && (p.name === "SpinSettled" || p.name === "SpinExpired"));
  console.log(`${ev.name}:`, ev.name === "SpinSettled"
    ? `reels ${ev.args.r0} ${ev.args.r1} ${ev.args.r2}, payout ${ethers.formatEther(ev.args.payout)} wZNN`
    : "expired");
  console.log(`${DEVNET.explorer}/tx/${rc2.hash}`);
  const blk = await ethers.provider.getBlock(target);
  const check = await slot.reelsFor(blk.hash, id);
  console.log(`reelsFor(blockhash) = ${check.join(" ")} (must match)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: Dry-run deploy on the local Hardhat network**

Run: `npx hardhat run scripts/deploy.js` (default network `hardhat`; `DEVNET.wrappedZnn` has no code there but the constructor only stores it, so deploy succeeds).
Expected: prints an address and writes `web/src/deployment.json` with `chainId: 7340469`. Then `git checkout -- web/src/deployment.json 2>/dev/null || rm web/src/deployment.json` so the local address is not committed.

- [ ] **Step 8: Commit scripts**

```bash
git add scripts
git commit -m "feat(scripts): deploy, verify via explorer API, faucet/fund, smoke

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Web app scaffold and pure logic (Vite + vitest)

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/public/CNAME`, `web/src/config.ts`, `web/src/abi.ts`, `web/src/logic.ts`, `web/src/logic.test.ts`, `web/src/deployment.json` (placeholder until Task 11)

**Interfaces:**
- Produces (`logic.ts`): `SYMBOLS: readonly {name, label, image}[]`; `parseBet(input: string, min: bigint, max: bigint): { ok: true; value: bigint } | { ok: false; message: string }`; `checkFunds(bet: bigint, wznn: bigint): string | null`; `faucetMessage(status: number, body: unknown): string`; `isDevnet(chainId: number | null): boolean`; `multiplierX10(a,b,c): number`; `formatZnn(wei: bigint, digits?: number): string`.
- Produces (`config.ts`): `DEVNET` viem chain, `ADDRESSES`, `EXPLORER`, `FAUCET_URL`, `ADD_CHAIN_PARAMS`.
- Produces (`abi.ts`): `SLOT_ABI`, `WETH_ABI` as `const`.

- [ ] **Step 1: Scaffold files**

`web/package.json`:
```json
{
  "name": "gamez-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "viem": "^2.57.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vite": "^8.3.0",
    "vitest": "^5.0.0"
  }
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: { target: "es2022", sourcemap: true },
});
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src"]
}
```

`web/public/CNAME`:
```
gamez.0x3639.com
```

`web/src/deployment.json` (placeholder; Task 11 overwrites):
```json
{ "chainId": 7340469, "address": "0x0000000000000000000000000000000000000000", "token": "0x91F5DDA8243e34697C99bE282e05bf48e35A0115", "owner": "0x0000000000000000000000000000000000000000", "deployBlock": 0, "constructorArgs": "0x", "txHash": "0x" }
```

`web/src/config.ts`:
```ts
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
```

`web/src/abi.ts`:
```ts
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
```

`web/index.html` (structure only; styling in Task 10):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>gamez — ZVM slots</title>
    <meta name="description" content="A three-reel slot machine on the Zenon ZVM devnet. Play money only." />
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Install**

Run: `cd web && npm install`
Expected: no errors.

- [ ] **Step 3: Write the failing logic tests**

`web/src/logic.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseBet, checkFunds, faucetMessage, isDevnet, multiplierX10, formatZnn, SYMBOLS } from "./logic";

const E = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;

describe("parseBet", () => {
  const min = E("0.1"), max = E("2.5");
  it("accepts a plain number within limits", () => {
    expect(parseBet("0.5", min, max)).toEqual({ ok: true, value: E("0.5") });
    expect(parseBet(" 2.5 ", min, max)).toEqual({ ok: true, value: max });
  });
  it("rejects empty, letters, too many decimals, out of range", () => {
    for (const bad of ["", "abc", "1e3", "0.0000000000000000001", "0.09", "2.51", "-1"]) {
      const r = parseBet(bad, min, max);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message).toBe("Enter a bet between 0.1 and 2.5 wZNN");
    }
  });
  it("explains when the machine cannot take any bet", () => {
    const r = parseBet("0.1", min, 0n);
    expect(r).toEqual({ ok: false, message: "The machine is out of bankroll right now" });
  });
});

describe("checkFunds", () => {
  it("null when enough, otherwise says how much you have", () => {
    expect(checkFunds(E("1"), E("1"))).toBeNull();
    expect(checkFunds(E("1"), E("0.25"))).toBe("You have 0.25 wZNN, wrap more first");
  });
});

describe("faucetMessage", () => {
  it("uses the faucet's error field, falls back per status", () => {
    expect(faucetMessage(429, { error: "cooldown: try again in 7s" })).toBe("cooldown: try again in 7s");
    expect(faucetMessage(500, {})).toBe("Faucet error (HTTP 500)");
    expect(faucetMessage(0, null)).toBe("Faucet unreachable");
    expect(faucetMessage(200, { l2Balance: "1" })).toBe("Sent 5 devnet ZNN to your wallet");
  });
});

describe("isDevnet", () => {
  it("only chain 7340469", () => {
    expect(isDevnet(7340469)).toBe(true);
    expect(isDevnet(69)).toBe(false);
    expect(isDevnet(null)).toBe(false);
  });
});

describe("paytable mirror", () => {
  it("matches the contract", () => {
    let total = 0;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) total += multiplierX10(a, b, c);
    expect(total).toBe(2090);
    expect(multiplierX10(5, 5, 5)).toBe(400);
    expect(multiplierX10(4, 4, 4)).toBe(200);
    expect(multiplierX10(0, 0, 0)).toBe(80);
    expect(multiplierX10(1, 2, 1)).toBe(13);
    expect(multiplierX10(0, 1, 2)).toBe(0);
    expect(SYMBOLS).toHaveLength(6);
    expect(SYMBOLS[5].name).toBe("moon");
    for (const s of SYMBOLS) expect(s.image).toMatch(/^\/symbols\/[a-z]+\.svg$/);
  });
});

describe("formatZnn", () => {
  it("trims trailing zeros, max 4 decimals by default", () => {
    expect(formatZnn(E("1.5"))).toBe("1.5");
    expect(formatZnn(E("0.13"))).toBe("0.13");
    expect(formatZnn(123456789012345678n)).toBe("0.1235");
    expect(formatZnn(0n)).toBe("0");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd web && npx vitest run`
Expected: FAIL, cannot resolve `./logic`.

- [ ] **Step 5: Implement logic.ts**

`web/src/logic.ts`:
```ts
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
  const s = formatUnits(wei, 18);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  const rounded = f.length > digits && Number("0." + f) !== Number("0." + f.slice(0, digits))
    ? formatUnits(wei + 10n ** BigInt(18 - digits) / 2n, 18) : null;
  if (rounded) return formatZnn(parseUnits(rounded, 18), digits);
  return frac ? `${i}.${frac}` : i;
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
```

Note on `formatZnn`: keep it simple if the rounding branch fights the tests — the required behaviour is "round half up to `digits` decimals, strip trailing zeros, no decimal point when zero". A straightforward alternative that passes the same tests:
```ts
export function formatZnn(wei: bigint, digits = 4): string {
  const unit = 10n ** BigInt(18 - digits);
  const rounded = (wei + unit / 2n) / unit;               // integer in 10^-digits units
  const i = rounded / 10n ** BigInt(digits);
  const f = (rounded % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}
```
Use this second version; delete the first.

- [ ] **Step 6: Run to verify it passes**

Run: `cd web && npx vitest run`
Expected: all logic tests passing.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(web): vite scaffold, chain config, ABI and tested pure logic

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Wallet, contract calls and the spin flow

**Files:**
- Create: `web/src/wallet.ts`, `web/src/chain.ts`, `web/src/faucet.ts`, `web/src/spin.ts`

**Interfaces:**
- Consumes: `config.ts`, `abi.ts`, `logic.ts`.
- Produces:
  - `wallet.ts`: `getInjected(): EIP1193Provider | null`; `connect(): Promise<Address>`; `ensureChain(): Promise<void>` (throws `Error("Switch to ZVM devnet to play")` on user rejection); `currentChainId(): Promise<number | null>`; `onWalletChange(cb: () => void): void`; `walletClient()`; `publicClient` (viem, HTTP transport to the RPC).
  - `chain.ts`: `readState(player: Address | null): Promise<State>` with `State = { znn: bigint; wznn: bigint; allowance: bigint; minBet: bigint; maxBet: bigint; bankroll: bigint; paused: boolean; block: bigint }`; `wrap(amount)`, `unwrap(amount)`, `approveMax()`, `placeBet(amount): Promise<{ id: bigint; targetBlock: bigint; txHash: Hash }>`, `settle(id): Promise<{ kind: "settled"; reels: [number,number,number]; payout: bigint; txHash: Hash } | { kind: "expired"; txHash: Hash }>`, `waitForBlockAfter(target: bigint): Promise<void>`, `findOpenSpins(player): Promise<{ id: bigint; amount: bigint; targetBlock: bigint }[]>`, `recentResults(player, n=10): Promise<Result[]>` with `Result = { id: bigint; amount: bigint; reels?: [number,number,number]; payout: bigint; expired: boolean; txHash: Hash }`.
  - `faucet.ts`: `requestFaucet(address): Promise<string>` (resolves to a message, never throws).
  - `spin.ts`: `runSpin(bet: bigint, hooks: SpinHooks): Promise<void>` orchestrating approve → place → wait → settle with `SpinHooks = { status(msg: string): void; placed(id: bigint, txHash: Hash): void; settled(r: Awaited<ReturnType<typeof settle>>): void }`.

- [ ] **Step 1: wallet.ts**

```ts
import { createPublicClient, createWalletClient, custom, http, type Address, type EIP1193Provider } from "viem";
import { ADD_CHAIN_PARAMS, CHAIN_ID, DEVNET, RPC_URL } from "./config";

declare global { interface Window { ethereum?: EIP1193Provider } }

export const publicClient = createPublicClient({ chain: DEVNET, transport: http(RPC_URL) });

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
    await p.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] }).catch(() => {
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
```

- [ ] **Step 2: chain.ts**

```ts
import { parseEventLogs, type Address, type Hash } from "viem";
import { SLOT_ABI, WETH_ABI } from "./abi";
import { ADDRESSES, BLOCK_TIME_MS } from "./config";
import { publicClient, walletClient } from "./wallet";

export type State = {
  znn: bigint; wznn: bigint; allowance: bigint;
  minBet: bigint; maxBet: bigint; bankroll: bigint; paused: boolean; block: bigint;
};

export type Result = {
  id: bigint; amount: bigint; reels?: [number, number, number]; payout: bigint; expired: boolean; txHash: Hash;
};

const slot = { address: ADDRESSES.slot, abi: SLOT_ABI } as const;
const wznn = { address: ADDRESSES.wznn, abi: WETH_ABI } as const;

export async function readState(player: Address | null): Promise<State> {
  const [minBet, maxBet, bankroll, paused, block] = await Promise.all([
    publicClient.readContract({ ...slot, functionName: "minBet" }),
    publicClient.readContract({ ...slot, functionName: "maxBet" }),
    publicClient.readContract({ ...slot, functionName: "bankroll" }),
    publicClient.readContract({ ...slot, functionName: "paused" }),
    publicClient.getBlockNumber(),
  ]);
  let znn = 0n, wz = 0n, allowance = 0n;
  if (player) {
    [znn, wz, allowance] = await Promise.all([
      publicClient.getBalance({ address: player }),
      publicClient.readContract({ ...wznn, functionName: "balanceOf", args: [player] }),
      publicClient.readContract({ ...wznn, functionName: "allowance", args: [player, ADDRESSES.slot] }),
    ]);
  }
  return { znn, wznn: wz, allowance, minBet, maxBet, bankroll, paused, block };
}

async function account(): Promise<Address> {
  const [a] = await walletClient().getAddresses();
  if (!a) throw new Error("Connect a wallet first");
  return a;
}

async function send(request: Parameters<ReturnType<typeof walletClient>["writeContract"]>[0]): Promise<Hash> {
  const hash = await walletClient().writeContract(request);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Transaction reverted");
  return hash;
}

export async function wrap(amount: bigint): Promise<Hash> {
  const a = await account();
  return send({ ...wznn, functionName: "deposit", value: amount, account: a });
}

export async function unwrap(amount: bigint): Promise<Hash> {
  const a = await account();
  return send({ ...wznn, functionName: "withdraw", args: [amount], account: a });
}

export async function approveMax(): Promise<Hash> {
  const a = await account();
  return send({ ...wznn, functionName: "approve", args: [ADDRESSES.slot, 2n ** 256n - 1n], account: a });
}

export async function placeBet(amount: bigint): Promise<{ id: bigint; targetBlock: bigint; txHash: Hash }> {
  const a = await account();
  const hash = await walletClient().writeContract({ ...slot, functionName: "placeBet", args: [amount], account: a });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Bet was rejected by the contract");
  const [ev] = parseEventLogs({ abi: SLOT_ABI, eventName: "SpinPlaced", logs: rc.logs });
  if (!ev) throw new Error("No SpinPlaced event in receipt");
  return { id: ev.args.id, targetBlock: ev.args.targetBlock, txHash: hash };
}

export type SettleOutcome =
  | { kind: "settled"; reels: [number, number, number]; payout: bigint; txHash: Hash }
  | { kind: "expired"; txHash: Hash };

export async function settle(id: bigint): Promise<SettleOutcome> {
  const a = await account();
  const hash = await walletClient().writeContract({ ...slot, functionName: "settle", args: [id], account: a });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Settle was rejected by the contract");
  const [s] = parseEventLogs({ abi: SLOT_ABI, eventName: "SpinSettled", logs: rc.logs });
  if (s) return { kind: "settled", reels: [s.args.r0, s.args.r1, s.args.r2], payout: s.args.payout, txHash: hash };
  return { kind: "expired", txHash: hash };
}

/** Resolve once block.number > target. Polls every 2 s; blocks land every ~10 s. */
export async function waitForBlockAfter(target: bigint): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await publicClient.getBlockNumber()) > target) return;
    await new Promise((r) => setTimeout(r, Math.min(2000, BLOCK_TIME_MS)));
  }
  throw new Error("The next block is taking too long; try Settle again in a moment");
}

export async function findOpenSpins(player: Address): Promise<{ id: bigint; amount: bigint; targetBlock: bigint }[]> {
  const logs = await publicClient.getContractEvents({
    ...slot, eventName: "SpinPlaced", args: { player }, fromBlock: ADDRESSES.deployBlock, toBlock: "latest",
  });
  const out: { id: bigint; amount: bigint; targetBlock: bigint }[] = [];
  for (const l of logs.slice(-50)) {
    const s = await publicClient.readContract({ ...slot, functionName: "spins", args: [l.args.id!] });
    if (!s[3]) out.push({ id: l.args.id!, amount: l.args.amount!, targetBlock: l.args.targetBlock! });
  }
  return out;
}

export async function recentResults(player: Address, n = 10): Promise<Result[]> {
  const [settled, expired] = await Promise.all([
    publicClient.getContractEvents({ ...slot, eventName: "SpinSettled", args: { player }, fromBlock: ADDRESSES.deployBlock, toBlock: "latest" }),
    publicClient.getContractEvents({ ...slot, eventName: "SpinExpired", args: { player }, fromBlock: ADDRESSES.deployBlock, toBlock: "latest" }),
  ]);
  const rows: Result[] = [
    ...settled.map((l) => ({ id: l.args.id!, amount: l.args.amount!, reels: [l.args.r0!, l.args.r1!, l.args.r2!] as [number, number, number], payout: l.args.payout!, expired: false, txHash: l.transactionHash })),
    ...expired.map((l) => ({ id: l.args.id!, amount: l.args.amount!, payout: 0n, expired: true, txHash: l.transactionHash })),
  ];
  return rows.sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, n);
}
```

- [ ] **Step 3: faucet.ts**

```ts
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
```

- [ ] **Step 4: spin.ts**

```ts
import { approveMax, placeBet, readState, settle, waitForBlockAfter, type SettleOutcome } from "./chain";
import { checkFunds } from "./logic";
import { currentAccount, ensureChain } from "./wallet";

export type SpinHooks = {
  status(msg: string): void;
  placed(id: bigint, txHash: `0x${string}`): void;
  settled(outcome: SettleOutcome): void;
};

/** approve (once) → placeBet → wait for target block → settle. Throws plain-English errors. */
export async function runSpin(bet: bigint, hooks: SpinHooks): Promise<void> {
  await ensureChain();
  const player = await currentAccount();
  if (!player) throw new Error("Connect a wallet first");
  const st = await readState(player);
  if (st.paused) throw new Error("The machine is paused");
  const fundsMsg = checkFunds(bet, st.wznn);
  if (fundsMsg) throw new Error(fundsMsg);
  if (st.allowance < bet) {
    hooks.status("Approve wZNN once in your wallet…");
    await approveMax();
  }
  hooks.status("Confirm the bet in your wallet…");
  const { id, targetBlock, txHash } = await placeBet(bet);
  hooks.placed(id, txHash);
  hooks.status("Bet placed. Waiting for the next block…");
  await waitForBlockAfter(targetBlock);
  hooks.status("Confirm settle in your wallet…");
  const outcome = await settle(id);
  hooks.settled(outcome);
}

/** Settle a spin left over from an earlier session. */
export async function resumeSpin(id: bigint, targetBlock: bigint, hooks: SpinHooks): Promise<void> {
  await ensureChain();
  hooks.status("Waiting for the target block…");
  await waitForBlockAfter(targetBlock);
  hooks.status("Confirm settle in your wallet…");
  hooks.settled(await settle(id));
}
```

- [ ] **Step 5: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. (viem's `writeContract` generic on `send()` may need `as any` on the request parameter if the union of the two ABIs does not infer; prefer two typed helpers `sendWznn`/`sendSlot` over `any`.)

- [ ] **Step 6: Commit**

```bash
git add web/src/wallet.ts web/src/chain.ts web/src/faucet.ts web/src/spin.ts
git commit -m "feat(web): wallet connection, contract calls and spin orchestration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9b: Placeholder meme artwork for the reels

**Files:**
- Create: `web/public/symbols/wojak.svg`, `web/public/symbols/pepe.svg`, `web/public/symbols/doge.svg`, `web/public/symbols/stonks.svg`, `web/public/symbols/chad.svg`, `web/public/symbols/moon.svg`
- Test: `web/src/symbols.test.ts`

**Interfaces:**
- Consumes: `SYMBOLS` from `logic.ts` (names and image paths fixed there).
- Produces: six square SVG files at the paths `SYMBOLS[i].image` resolves to under `web/public/`.

These are placeholders the owner will replace later. They must be original drawings made in this repo, in the flat, instantly recognisable style of the memes named, never downloaded, traced, or copied files. Use the `frontend-design` skill for the drawing pass.

- [ ] **Step 1: Write the failing test**

`web/src/symbols.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SYMBOLS } from "./logic";

const pub = join(__dirname, "..", "public");

describe("reel artwork", () => {
  for (const s of SYMBOLS) {
    it(`${s.name} exists, is square SVG, and has no external references`, () => {
      const file = join(pub, s.image);
      expect(existsSync(file), file).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);      // square
      expect(svg).not.toMatch(/href=|url\(|<image|<script/i);   // self-contained, no raster, no scripts
      expect(svg.length).toBeLessThan(12_000);           // hand-drawn flat art, not an exported bitmap
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/symbols.test.ts`
Expected: 6 failing on `existsSync`.

- [ ] **Step 3: Draw the six SVGs**

Each file: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` with a rounded-square background (`rx="24"`) in a colour that separates the symbols at a glance, and a flat, bold, few-path figure filling about 80% of the tile. Keep every file self-contained (no `href`, `url()`, `<image>`, `<script>`, no fonts other than `system-ui` text where a word is part of the meme). Subjects:

| index | file | what to draw | background |
|---|---|---|---|
| 0 | wojak.svg | bald pale head, thin neck, small sad downturned mouth, two dot eyes, the "feels" look; grey line art on a light grey tile | `#cfd3da` |
| 1 | pepe.svg | green frog face: big half-closed eyes with heavy lids, wide flat mouth with a hint of smirk, red lower lip line | `#6fbf73` background with darker green `#3f8f45` face |
| 2 | doge.svg | tan shiba inu face: pointed ears, round cheeks, small black nose, side-eye pupils, cream muzzle; add two tiny Comic-style words "wow" and "such" in `system-ui` italic | `#f2c14e` |
| 3 | stonks.svg | blue suit torso with a grey featureless head, and a big bright orange arrow rising left-to-right with a jagged step; word "STONKS" in bold caps at the bottom | `#1d3557` |
| 4 | chad.svg | gigachad: black and white, strong jaw, square chin, short dark hair, stern profile facing left, heavy shading blocks | `#111111` with `#e8e8e8` figure |
| 5 | moon.svg | jackpot: a white rocket angled up-right with a flame, a big pale-yellow crescent moon behind, three small stars; word "MOON" small at the bottom | `#0b1a3a` |

Save each with `\n` line endings and no XML prolog. Open the folder in the browser (`npm run dev`, then `/symbols/pepe.svg` etc.) and adjust until each reads as its meme at 96 px and at 22 px.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run`
Expected: all passing, including the 6 artwork checks.

- [ ] **Step 5: Commit**

```bash
git add web/public/symbols web/src/symbols.test.ts
git commit -m "feat(web): placeholder meme artwork for the six reel symbols

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: UI — reels, panels, styling, main wiring

**Files:**
- Create: `web/src/main.ts`, `web/src/ui.ts`, `web/src/reels.ts`, `web/src/style.css`, `web/public/favicon.svg`

**Interfaces:**
- Consumes: everything from Tasks 8–9.
- Produces: the page. `reels.ts`: `class Reels { constructor(root: HTMLElement); start(): void; stopOn(reels: [number,number,number]): Promise<void>; showIdle(): void }`.

Use the `frontend-design` skill before writing `style.css` and the markup: the direction is a dark casino cabinet with a single warm accent, tabular numerals for balances, big legible reels, and motion that respects `prefers-reduced-motion`.

- [ ] **Step 1: reels.ts (CSS-driven, no library)**

```ts
import { SYMBOLS } from "./logic";

const STRIP = [...SYMBOLS, ...SYMBOLS, ...SYMBOLS]; // three copies so the strip can scroll
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Reels {
  private cols: HTMLElement[];
  constructor(root: HTMLElement) {
    root.innerHTML = "";
    this.cols = [0, 1, 2].map(() => {
      const col = document.createElement("div");
      col.className = "reel";
      const strip = document.createElement("div");
      strip.className = "strip";
      for (const s of STRIP) {
        const cell = document.createElement("div");
        cell.className = `cell sym-${s.name}`;
        const img = document.createElement("img");
        img.src = s.image;
        img.alt = s.label;
        img.draggable = false;
        cell.appendChild(img);
        strip.appendChild(cell);
      }
      col.appendChild(strip);
      root.appendChild(col);
      return col;
    });
    this.showIdle();
  }

  start(): void {
    this.cols.forEach((c, i) => {
      c.classList.remove("win");
      c.classList.add("spinning");
      (c.firstElementChild as HTMLElement).style.animationDelay = `${i * 120}ms`;
    });
  }

  /** Stop each reel on its symbol, left to right, resolving after the last one lands. */
  async stopOn(reels: [number, number, number]): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const col = this.cols[i];
      const strip = col.firstElementChild as HTMLElement;
      col.classList.remove("spinning");
      // middle copy of the strip: index 6 + symbol, cell height from CSS var
      strip.style.transition = reduced() ? "none" : "transform 600ms cubic-bezier(.2,.9,.3,1.2)";
      strip.style.transform = `translateY(calc(-1 * (${6 + reels[i]}) * var(--cell)))`;
      await new Promise((r) => setTimeout(r, reduced() ? 0 : 650));
    }
  }

  markWin(): void { this.cols.forEach((c) => c.classList.add("win")); }

  showIdle(): void {
    this.cols.forEach((c, i) => {
      c.classList.remove("spinning", "win");
      const strip = c.firstElementChild as HTMLElement;
      strip.style.transition = "none";
      strip.style.transform = `translateY(calc(-1 * (${6 + ((i * 2) % 6)}) * var(--cell)))`;
    });
  }
}
```

- [ ] **Step 2: ui.ts (DOM helpers and panel renderers)**

```ts
import type { Address } from "viem";
import { EXPLORER } from "./config";
import { formatZnn, multiplierX10, SYMBOLS } from "./logic";
import type { Result, State } from "./chain";

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export function short(a: Address): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
export function txLink(hash: string): string { return `${EXPLORER}/tx/${hash}`; }
export function addrLink(a: string): string { return `${EXPLORER}/address/${a}`; }

export function sym(i: number): string {
  const s = SYMBOLS[i];
  return `<img class="symsmall" src="${s.image}" alt="${s.label}" />`;
}

export function layout(slotAddress: string): string {
  return `
  <header class="top">
    <div class="brand"><span class="logo">Z</span> gamez <span class="tag">ZVM devnet</span></div>
    <div class="wallet"><span id="net" class="pill">not connected</span><button id="connect" class="btn">Connect wallet</button></div>
  </header>
  <main class="wrap">
    <section class="cabinet">
      <div class="marquee"><span>ZENON SLOTS</span><span class="sub">play money · devnet</span></div>
      <div id="reels" class="reels" aria-live="polite"></div>
      <div id="result" class="result" role="status"></div>
      <form id="betform" class="controls" autocomplete="off">
        <label class="betlabel">Bet <input id="bet" inputmode="decimal" value="0.5" aria-describedby="limits" /> <span class="unit">wZNN</span></label>
        <div id="limits" class="limits"></div>
        <button id="spin" class="btn spin" type="submit" disabled>SPIN</button>
      </form>
      <div id="status" class="status"></div>
      <div id="resume" class="resume hidden"></div>
    </section>

    <section class="panel" id="funds">
      <h2>Your funds</h2>
      <dl class="stats">
        <div><dt>ZNN</dt><dd id="znn">–</dd></div>
        <div><dt>wZNN</dt><dd id="wznn">–</dd></div>
        <div><dt>Bankroll</dt><dd id="bankroll">–</dd></div>
      </dl>
      <div class="row">
        <button id="faucet" class="btn ghost" disabled>Get 5 devnet ZNN</button>
      </div>
      <form id="wrapform" class="row">
        <input id="wrapamt" inputmode="decimal" placeholder="amount" aria-label="amount to wrap or unwrap" />
        <button id="wrap" class="btn ghost" type="submit" disabled>Wrap ZNN → wZNN</button>
        <button id="unwrap" class="btn ghost" type="button" disabled>Unwrap</button>
      </form>
      <p id="fundsmsg" class="muted"></p>
    </section>

    <section class="panel">
      <h2>Recent spins</h2>
      <ol id="history" class="history"><li class="muted">Connect to see your spins.</li></ol>
    </section>

    <section class="panel">
      <h2>Paytable</h2>
      <table class="paytable">
        <tr><td>${sym(5)} ${sym(5)} ${sym(5)}</td><td>${multiplierX10(5,5,5)/10}×</td></tr>
        <tr><td>${sym(4)} ${sym(4)} ${sym(4)}</td><td>${multiplierX10(4,4,4)/10}×</td></tr>
        <tr><td>any other three of a kind</td><td>${multiplierX10(0,0,0)/10}×</td></tr>
        <tr><td>any pair</td><td>${multiplierX10(0,0,1)/10}×</td></tr>
      </table>
      <p class="muted">Return to player 96.8%. Each spin is two transactions: place the bet, then settle once the next block exists. The result comes from that block's hash and cannot be changed by when you settle. Unsettled spins are forfeited after 256 blocks (about 40 minutes).</p>
    </section>
  </main>
  <footer class="foot">
    <a href="${addrLink(slotAddress)}" target="_blank" rel="noopener">contract ${short(slotAddress as Address)}</a>
    · <a href="https://devnet.zenon.foo/status/" target="_blank" rel="noopener">devnet status</a>
    · devnet play money, nothing here has value
  </footer>`;
}

export function renderState(s: State, player: Address | null): void {
  $("#znn").textContent = player ? formatZnn(s.znn) : "–";
  $("#wznn").textContent = player ? formatZnn(s.wznn) : "–";
  $("#bankroll").textContent = `${formatZnn(s.bankroll)} wZNN`;
  $("#limits").textContent = s.paused ? "Machine paused" : `min ${formatZnn(s.minBet)} · max ${formatZnn(s.maxBet)} wZNN`;
}

export function renderHistory(rows: Result[]): void {
  const ol = $("#history");
  if (!rows.length) { ol.innerHTML = `<li class="muted">No spins yet.</li>`; return; }
  ol.innerHTML = rows.map((r) => {
    const reels = r.reels ? r.reels.map((i) => sym(i)).join(" ") : "expired";
    const out = r.expired ? "forfeited" : r.payout > 0n ? `+${formatZnn(r.payout)}` : "no win";
    return `<li><span class="reelsmall">${reels}</span><span>${formatZnn(r.amount)} wZNN</span><span class="${r.payout > 0n ? "win" : ""}">${out}</span><a href="${txLink(r.txHash)}" target="_blank" rel="noopener">tx</a></li>`;
  }).join("");
}

export function setStatus(msg: string, kind: "" | "error" | "ok" = ""): void {
  const el = $("#status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

export function errorText(e: unknown): string {
  const anyE = e as { shortMessage?: string; message?: string; code?: number };
  if (anyE?.code === 4001 || /rejected/i.test(anyE?.message ?? "")) return "Cancelled in the wallet";
  return anyE?.shortMessage ?? anyE?.message ?? String(e);
}
```

- [ ] **Step 3: main.ts (wiring)**

```ts
import "./style.css";
import type { Address } from "viem";
import { parseUnits } from "viem";
import { ADDRESSES } from "./config";
import { findOpenSpins, readState, recentResults, unwrap, wrap, type SettleOutcome } from "./chain";
import { requestFaucet } from "./faucet";
import { formatZnn, parseBet } from "./logic";
import { Reels } from "./reels";
import { resumeSpin, runSpin } from "./spin";
import { $, errorText, layout, renderHistory, renderState, setStatus, short, txLink } from "./ui";
import { connect, currentAccount, currentChainId, ensureChain, getInjected, onWalletChange } from "./wallet";
import { isDevnet } from "./logic";

const app = $("#app");
app.innerHTML = layout(ADDRESSES.slot);
const reels = new Reels($("#reels"));

let player: Address | null = null;
let busy = false;
let state = await readState(null);
renderState(state, null);

async function refresh(): Promise<void> {
  player = await currentAccount();
  const chainId = await currentChainId();
  const onDevnet = isDevnet(chainId);
  $("#net").textContent = player ? (onDevnet ? `ZVM devnet · ${short(player)}` : `wrong network · ${short(player)}`) : "not connected";
  $("#net").className = `pill ${player && !onDevnet ? "warn" : ""}`;
  $("#connect").textContent = player ? (onDevnet ? "Connected" : "Switch to ZVM devnet") : "Connect wallet";
  state = await readState(player && onDevnet ? player : null);
  renderState(state, player && onDevnet ? player : null);
  const enabled = !!player && onDevnet && !busy;
  for (const id of ["#spin", "#faucet", "#wrap", "#unwrap"]) ($(id) as HTMLButtonElement).disabled = !enabled;
  if (player && onDevnet) {
    renderHistory(await recentResults(player));
    const open = await findOpenSpins(player);
    const box = $("#resume");
    if (open.length && !busy) {
      const o = open[0];
      box.classList.remove("hidden");
      box.innerHTML = `You have an unsettled spin of ${formatZnn(o.amount)} wZNN. <button id="settleopen" class="btn">Settle it</button>`;
      $("#settleopen").addEventListener("click", () => guard(() => resumeSpin(o.id, o.targetBlock, hooks)));
    } else {
      box.classList.add("hidden");
      box.innerHTML = "";
    }
  } else {
    renderHistory([]);
  }
}

const hooks = {
  status: (m: string) => setStatus(m),
  placed: (_id: bigint, txHash: `0x${string}`) => {
    reels.start();
    $("#result").innerHTML = `<a href="${txLink(txHash)}" target="_blank" rel="noopener">bet placed ↗</a>`;
  },
  settled: async (o: SettleOutcome) => {
    if (o.kind === "expired") {
      reels.showIdle();
      $("#result").innerHTML = `Spin expired, bet forfeited. <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("");
      return;
    }
    await reels.stopOn(o.reels);
    if (o.payout > 0n) {
      reels.markWin();
      $("#result").innerHTML = `<strong>You win ${formatZnn(o.payout)} wZNN</strong> <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("Paid out", "ok");
    } else {
      $("#result").innerHTML = `No win this time. <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("");
    }
  },
};

async function guard(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  ($("#spin") as HTMLButtonElement).disabled = true;
  try {
    await fn();
  } catch (e) {
    reels.showIdle();
    setStatus(errorText(e), "error");
  } finally {
    busy = false;
    await refresh();
  }
}

$("#connect").addEventListener("click", () => guard(async () => {
  if (!getInjected()) { setStatus("No wallet found. Install MetaMask or Rabby.", "error"); return; }
  await connect();
  await ensureChain();
  setStatus("");
}));

$("#betform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  guard(async () => {
    const parsed = parseBet(($("#bet") as HTMLInputElement).value, state.minBet, state.maxBet);
    if (!parsed.ok) throw new Error(parsed.message);
    $("#result").textContent = "";
    await runSpin(parsed.value, hooks);
  });
});

$("#faucet").addEventListener("click", () => guard(async () => {
  if (!player) throw new Error("Connect a wallet first");
  $("#fundsmsg").textContent = "Asking the faucet…";
  $("#fundsmsg").textContent = await requestFaucet(player);
  await new Promise((r) => setTimeout(r, 12_000)); // faucet tx lands in the next block
}));

$("#wrapform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  guard(async () => {
    const v = ($("#wrapamt") as HTMLInputElement).value.trim();
    if (!/^\d+(\.\d{1,18})?$/.test(v) || Number(v) <= 0) throw new Error("Enter an amount to wrap");
    const amt = parseUnits(v, 18);
    if (amt > state.znn) throw new Error(`You have ${formatZnn(state.znn)} ZNN`);
    await ensureChain();
    $("#fundsmsg").textContent = "Confirm wrap in your wallet…";
    await wrap(amt);
    $("#fundsmsg").textContent = `Wrapped ${v} ZNN`;
  });
});

$("#unwrap").addEventListener("click", () => guard(async () => {
  const v = ($("#wrapamt") as HTMLInputElement).value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(v) || Number(v) <= 0) throw new Error("Enter an amount to unwrap");
  const amt = parseUnits(v, 18);
  if (amt > state.wznn) throw new Error(`You have ${formatZnn(state.wznn)} wZNN`);
  await ensureChain();
  $("#fundsmsg").textContent = "Confirm unwrap in your wallet…";
  await unwrap(amt);
  $("#fundsmsg").textContent = `Unwrapped ${v} wZNN`;
}));

onWalletChange(() => { refresh(); });
await refresh();
setInterval(() => { if (!busy) refresh(); }, 30_000);
```

- [ ] **Step 4: style.css and favicon**

Write `web/src/style.css` following the frontend-design skill. Hard requirements the reviewer checks:
- `:root` tokens: `--bg`, `--panel`, `--ink`, `--muted`, `--accent` (one warm gold), `--win`, `--error`, `--cell: 96px` (reel cell height; `72px` under 420 px width).
- `.reels { display:grid; grid-template-columns: repeat(3, 1fr); gap: 12px }`, `.reel { height: var(--cell); overflow: hidden }`, `.strip .cell { height: var(--cell); display:grid; place-items:center; font-size: calc(var(--cell) * .55) }`.
- `.reel.spinning .strip { animation: spin 350ms linear infinite }` with `@keyframes spin { from { transform: translateY(0) } to { transform: translateY(calc(-6 * var(--cell))) } }`.
- `@media (prefers-reduced-motion: reduce) { .reel.spinning .strip { animation: none; opacity: .6 } }`.
- `.reel.win { box-shadow: 0 0 0 3px var(--win), 0 0 24px var(--win) }`.
- `.paytable img`, `.history img` never exceed 22 px.
- `.wrap { max-width: 720px; margin: 0 auto; padding: 0 16px }`; `body { margin:0; background: var(--bg); color: var(--ink) }`; no element wider than the viewport at 360 px.
- `.status.error { color: var(--error) }`, `.status.ok { color: var(--win) }`, `.pill.warn { background: var(--error) }`, `.hidden { display: none }`.
- Numerals: `font-variant-numeric: tabular-nums` on `.stats dd`, `.history`.

`web/public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#111"/><text x="16" y="23" text-anchor="middle" font-family="system-ui" font-weight="800" font-size="20" fill="#f5c542">Z</text></svg>
```

- [ ] **Step 5: Build and open the page against the placeholder address**

Run: `cd web && npm run build && npm run preview`
Open in the built-in browser at the preview URL. Expected: the layout renders, the machine shows idle reels, "not connected" pill, Spin disabled, no console errors other than a failed `maxBet` read against the zero address (expected until Task 11). Take a phone-width screenshot (375 px) and confirm no horizontal scroll.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): slot machine UI, reels, wallet and funds panels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Deploy, verify and fund on the devnet

**Files:**
- Modify: `web/src/deployment.json` (real values), `README.md` (address)
- Uses: `.env` (never committed)

- [ ] **Step 1: Generate the deployer key**

Run: `node scripts/new-key.js`
Expected: prints `new deployer: 0x…`. `.env` now exists with mode 600. `git status` must NOT list `.env`.

- [ ] **Step 2: Faucet the deployer**

Run: `FAUCET_ONLY=1 FAUCET_REQUESTS=12 npm run fund:devnet`
Expected: 12 lines of `faucet i/12: ok` (a `cooldown` line means retry that one after 11 s), final balance ≈ 60 ZNN. Takes about 2.5 minutes.

- [ ] **Step 3: Deploy**

Run: `npm run deploy:devnet`
Expected: prints `SlotMachine at 0x…` and an explorer link; `web/src/deployment.json` has the real address and `deployBlock`. Open the explorer link and confirm the contract creation transaction is there.

- [ ] **Step 4: Verify**

Run: `npm run verify:devnet`
Expected: `verified: https://devnet.zenon.foo/explorer/address/0x…`. Open it; the page says "Verified contract: SlotMachine, exact match" (as the WETH9 page does). If the verifier reports a bytecode mismatch, check that `hardhat.config.js` evmVersion/optimizer match what was compiled (`artifacts/build-info/*.json` → `input.settings`) and resend.

- [ ] **Step 5: Fund the bankroll**

Run: `FAUCET_REQUESTS=0 BANKROLL=50 npm run fund:devnet`
Expected: `bankroll 50.0 wZNN, maxBet 1.25 wZNN`. Confirm on the explorer that the contract's wZNN balance is 50.

- [ ] **Step 6: Record and commit**

Add to README.md under a `## Devnet deployment` heading: the contract address as an explorer link, the wZNN address, and "owner: deployer key on the maintainer's machine; transfer with `transferOwnership` + `acceptOwnership`".

```bash
git add web/src/deployment.json README.md
git commit -m "deploy: SlotMachine on ZVM devnet, verified and funded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Devnet smoke test (contract) and browser end-to-end check (web)

**Files:** none new.

- [ ] **Step 1: Contract smoke test on the real chain**

Run: `npm run smoke:devnet`
Expected: `placed spin N …`, dots while waiting, then `SpinSettled: reels a b c, payout X wZNN` and `reelsFor(blockhash) = a b c (must match)`. Both reel lines identical. This proves `blockhash(targetBlock)` works on the ZVM and the two-step flow settles on the real chain. If the line says `SpinExpired`, the chain returned a zero hash for a recent block: stop and report; the contract must not be advertised until this passes.

- [ ] **Step 2: Web end-to-end with a real wallet**

Run `cd web && npm run dev` and open the URL in the built-in browser. MetaMask is not available in that browser, so for the end-to-end check ask the user to open the same local URL in their own browser with MetaMask, or (preferred) use Claude in Chrome if the user has MetaMask there and asks for it. Confirm in order:
  1. Connect → the wallet prompts to add "ZVM devnet" with chain id 7340469 → pill shows `ZVM devnet · 0x…`.
  2. Get 5 devnet ZNN → message from the faucet → ZNN balance rises within ~12 s.
  3. Wrap 2 → wZNN shows 2.
  4. Bet 0.5 → Spin → approve prompt (first time) → bet prompt → reels spin → settle prompt → reels stop → result text with tx links → history shows the spin.
  5. Reload mid-spin after the bet prompt is confirmed but before settle → "You have an unsettled spin" → Settle it → pays.
  6. Type `abc` as the bet → "Enter a bet between 0.1 and 1.25 wZNN", no wallet prompt.
  7. Switch the wallet to another network → pill turns to "wrong network", Spin disabled; press the header button → switches back.

Record what was checked and by whom in the final report; do not claim steps the user did not run.

- [ ] **Step 3: Phone-width check in the built-in browser**

Resize to 375×812, reload. Expected: no horizontal scroll, reels legible, buttons full-width. Reset to desktop after.

---

### Task 13: GitHub Pages deployment

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Workflow**

```yaml
name: Deploy web to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Push to the empty repo**

```bash
git remote add origin https://github.com/0x3639/gamez.git
git push -u origin main
```
Expected: push succeeds (the repo is empty, no history to reconcile).

- [ ] **Step 3: Enable Pages with the Actions source and the custom domain**

Run: `gh api -X POST repos/0x3639/gamez/pages -f build_type=workflow` (if it returns 409 "already exists", use `-X PUT` with the same field). Then `gh api -X PUT repos/0x3639/gamez/pages -f cname=gamez.0x3639.com`.
Then `gh workflow run pages.yml` if the push did not already trigger it; `gh run watch` until green.
Expected: `gh api repos/0x3639/gamez/pages` shows `"cname": "gamez.0x3639.com"`, `"status": "built"`, and `https://0x3639.github.io/gamez/` may 404 (custom-domain builds serve at the domain only).

- [ ] **Step 4: DNS (user action)**

Tell the user: add a DNS `CNAME` record `gamez` → `0x3639.github.io` at the 0x3639.com DNS provider. Once it resolves, run `gh api -X PUT repos/0x3639/gamez/pages -f https_enforced=true`. Check `curl -sI https://gamez.0x3639.com | head -3` returns 200 with the page.

- [ ] **Step 5: Commit the workflow (before the push in Step 2 — order: commit, then push)**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy web to GitHub Pages at gamez.0x3639.com

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: contract state/flows/paytable/views/owner/events/errors (Tasks 3–6), security table (Task 5 shopping + reentrancy tests, Task 4 fee-on-transfer and pause, Task 6 ownership/withdraw/invariants/Slither), tests list (Tasks 2–6), front end config/layout/spin flow/wallet handling/visual constraints (Tasks 8–10), repo layout (Tasks 1, 7, 8, 13), deployment steps 1–7 (Tasks 11–13), out-of-scope respected.
- Type consistency: `SpinPlaced(id, player, amount, targetBlock)`, `SpinSettled(id, player, amount, r0, r1, r2, payout)`, `SpinExpired(id, player, amount)` identical in contract, tests, `abi.ts`, scripts. `multiplierX10`, `reelsFor`, `maxBet`, `unlockedBalance`, `canSettle`, `bankroll` used with the same names everywhere. `placeBet` returns `{id, targetBlock, txHash}` in `chain.ts` and is consumed as such in `spin.ts`.
- Review Focus lines each map to a test or a checked step: 1 → Task 9 `ensureChain` first in `runSpin` + Task 12 step 7; 2 → Task 8 `parseBet` tests; 3 → Task 9 `findOpenSpins` + Task 12 step 5; 4 → Task 8 `faucetMessage` tests; 5 → Task 8 `checkFunds` tests + Task 9 approve branch.
