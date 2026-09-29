// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC-20 that, once armed, calls `target` with `data` from inside every transfer,
/// recording the outcome and revert data so tests can assert why the re-entrant call was rejected.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public data;
    bool public armed;
    bool public lastReentryOk;
    bytes public lastReentryData;
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

    /// Lets this token contract hold an allowance toward `spender`, so a re-entrant call made
    /// with msg.sender == this token could otherwise succeed and only a guard can stop it.
    function selfApprove(address spender) external {
        _approve(address(this), spender, type(uint256).max);
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0)) {
            armed = false; // one attempt per transfer, no infinite loops
            reentryAttempts += 1;
            (bool ok, bytes memory ret) = target.call(data);
            lastReentryOk = ok;
            lastReentryData = ret;
            armed = true;
        }
    }
}
