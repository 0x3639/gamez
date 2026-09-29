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
