// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISlotR {
    function placeBet() external payable returns (uint256);
    function settle(uint256 id) external;
    function withdrawPayout() external;
}

/// Player contract that, when paid, immediately tries to call back into the machine and records the result.
contract ReentrantPlayer {
    ISlotR public slot;
    bytes public data;
    uint256 public reentryValue;
    bool public armed;
    uint256 public attempts;
    bool public lastOk;
    bytes public lastData;

    constructor(ISlotR slot_) { slot = slot_; }

    function arm(bytes calldata data_) external { data = data_; reentryValue = 0; armed = true; }
    function armWithValue(bytes calldata data_, uint256 value_) external { data = data_; reentryValue = value_; armed = true; }
    function disarm() external { armed = false; }
    function bet(uint256 amount) external returns (uint256) { return slot.placeBet{value: amount}(); }
    function settle(uint256 id) external { slot.settle(id); }
    function claim() external { slot.withdrawPayout(); }
    function fundMe() external payable {}

    receive() external payable {
        if (armed) {
            armed = false;
            attempts += 1;
            (bool ok, bytes memory ret) = address(slot).call{value: reentryValue}(data);
            lastOk = ok;
            lastData = ret;
            armed = true;
        }
    }
}
