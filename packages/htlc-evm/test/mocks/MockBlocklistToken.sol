// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockBlocklistToken is ERC20 {
    mapping(address => bool) public isBlacklisted;

    constructor() ERC20("Mock Blocklist USDC", "USDC") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlacklisted(address account, bool blocked) external {
        isBlacklisted[account] = blocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!isBlacklisted[to], "recipient blacklisted");
        super._update(from, to, value);
    }
}
