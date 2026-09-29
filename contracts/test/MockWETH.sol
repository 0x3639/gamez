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
