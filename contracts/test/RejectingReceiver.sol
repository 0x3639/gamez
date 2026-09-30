// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISlot {
    function placeBet() external payable returns (uint256);
    function settle(uint256 id) external;
    function withdrawPayout() external;
}

/// Player contract that refuses incoming ZNN unless told to accept, to exercise the pull-payout path.
contract RejectingReceiver {
    bool public accept;

    receive() external payable {
        require(accept, "no thanks");
    }

    function setAccept(bool v) external { accept = v; }
    function bet(ISlot slot, uint256 amount) external returns (uint256) { return slot.placeBet{value: amount}(); }
    function settle(ISlot slot, uint256 id) external { slot.settle(id); }
    function claim(ISlot slot) external { slot.withdrawPayout(); }
    function fundMe() external payable {}
}
