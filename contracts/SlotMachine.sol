// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SlotMachine — three-reel slot on the Zenon ZVM devnet, bets in native ZNN.
/// @notice Two steps per spin: `placeBet` takes the wager and fixes the *next* block as the
///         randomness source; `settle` (anyone, once that block exists) derives the reels from
///         that block's hash and pays out. Nothing from the settle block enters the seed, so
///         choosing when to settle cannot change the result. Not settling forfeits the bet.
/// @dev    Devnet demo. The block producer could in principle influence the target hash; a VRF
///         would be required for real value.
contract SlotMachine is Ownable2Step, ReentrancyGuard, Pausable {

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

    uint256 public minBet;
    uint256 public maxBetCap;
    uint256 public locked;        // sum of amount * MAX_MULTIPLIER over unsettled spins
    uint256 public nextSpinId = 1;
    mapping(uint256 => Spin) public spins;
    /// @notice Payouts that could not be delivered (the player is a contract that rejected ZNN);
    ///         claimable with `withdrawPayout`. Counted in `locked` until claimed.
    mapping(address => uint256) public owed;

    event SpinPlaced(uint256 indexed id, address indexed player, uint256 amount, uint256 targetBlock);
    event SpinSettled(uint256 indexed id, address indexed player, uint256 amount, uint8 r0, uint8 r1, uint8 r2, uint256 payout);
    event SpinExpired(uint256 indexed id, address indexed player, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event LimitsSet(uint256 minBet, uint256 maxBetCap);
    event PayoutDeferred(address indexed player, uint256 amount);
    event PayoutClaimed(address indexed player, uint256 amount);

    error BadLimits();
    error BetTooSmall();
    error BetTooLarge();
    error UnknownSpin();
    error AlreadySettled();
    error TooEarly();
    error InsufficientUnlocked();
    error NothingOwed();
    error SendFailed();
    error RenounceDisabled();

    constructor(address owner_, uint256 minBet_, uint256 maxBetCap_) Ownable(owner_) {
        _setLimits(minBet_, maxBetCap_);
    }

    /// @notice Plain ZNN sent to the contract tops up the bankroll.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- views

    /// @notice Largest bet accepted right now: the owner cap, or what the unreserved bankroll can pay at 40x.
    function maxBet() public view returns (uint256) {
        uint256 unlocked = unlockedBalance();
        uint256 byBankroll = unlocked / MAX_MULTIPLIER;
        return byBankroll < maxBetCap ? byBankroll : maxBetCap;
    }

    function bankroll() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Bankroll not reserved for open spins. Zero if reservations exceed the balance.
    function unlockedBalance() public view returns (uint256) {
        uint256 bal = address(this).balance;
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
        if (a == b || b == c || a == c) return 12;
        return 0;
    }

    /// @notice Reels for a given target block hash and spin id. Pure so anyone can audit a result.
    /// @dev Each reel takes a full 256-bit hash mod 6; modulo bias is ~2^-254, i.e. none in practice.
    function reelsFor(bytes32 blockHash, uint256 id) public pure returns (uint8 r0, uint8 r1, uint8 r2) {
        bytes32 seed = keccak256(abi.encodePacked(blockHash, id));
        // slither-disable-start weak-prng (block hash as the seed is the documented devnet design)
        r0 = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(0)))) % SYMBOLS);
        r1 = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(1)))) % SYMBOLS);
        r2 = uint8(uint256(keccak256(abi.encodePacked(seed, uint8(2)))) % SYMBOLS);
        // slither-disable-end weak-prng
    }

    // ---------------------------------------------------------------- player

    /// @notice Wager the ZNN sent with the call. The result is decided by the hash of the next
    ///         block; call `settle(id)` once it exists.
    /// @return id The spin id to settle.
    function placeBet() external payable nonReentrant whenNotPaused returns (uint256 id) {
        uint256 amount = msg.value;
        if (amount < minBet) revert BetTooSmall();
        // msg.value is already part of address(this).balance, so exclude it from the bankroll check.
        uint256 bal = address(this).balance - amount;
        uint256 unlocked = bal > locked ? bal - locked : 0;
        uint256 byBankroll = unlocked / MAX_MULTIPLIER;
        uint256 limit = byBankroll < maxBetCap ? byBankroll : maxBetCap;
        if (amount > limit) revert BetTooLarge();

        id = nextSpinId++;
        uint64 target = uint64(block.number + 1);
        spins[id] = Spin({player: msg.sender, amount: uint96(amount), targetBlock: target, settled: false});
        locked += amount * MAX_MULTIPLIER;
        emit SpinPlaced(id, msg.sender, amount, target);
    }

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
        if (payout > 0) _pay(player, payout);
    }

    /// @notice Claim a payout that could not be delivered at settle time.
    function withdrawPayout() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        locked -= amount;
        emit PayoutClaimed(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert SendFailed();
    }

    // ---------------------------------------------------------------- owner

    /// @notice Stop new bets (a found bug, a drained bankroll). Settling is never paused.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Add to the bankroll. Anyone may top it up.
    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Withdraw bankroll that is not reserved for open spins.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount > unlockedBalance()) revert InsufficientUnlocked();
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert SendFailed();
    }

    function setLimits(uint256 minBet_, uint256 maxBetCap_) external onlyOwner {
        _setLimits(minBet_, maxBetCap_);
    }

    // ---------------------------------------------------------------- internal

    /// @dev Push the payout; if the receiver rejects it, keep it reserved and let them pull it.
    function _pay(address player, uint256 amount) internal {
        (bool ok, ) = player.call{value: amount, gas: 30_000}("");
        if (!ok) {
            owed[player] += amount;
            locked += amount;
            emit PayoutDeferred(player, amount);
        }
    }

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
