// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only ERC-20 that burns a 1% fee on every transfer.
contract MockFeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1%

    constructor() ERC20("Fee Token", "FEE") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * FEE_BPS) / 10_000;
            uint256 net = value - fee;
            if (fee > 0) {
                super._update(from, address(0), fee);
            }
            super._update(from, to, net);
            return;
        }
        super._update(from, to, value);
    }
}
