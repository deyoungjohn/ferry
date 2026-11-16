// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test-only rebasing ERC-20 using internal shares and a mutable multiplier (1e18 = 1.0x).
contract MockRebasingToken is IERC20 {
    string public constant name = "Rebase Token";
    string public constant symbol = "RBT";
    uint8 public constant decimals = 6;

    uint256 public multiplier = 1e18;
    uint256 private _totalShares;
    mapping(address => uint256) private _shares;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        uint256 shares = (amount * 1e18) / multiplier;
        _shares[to] += shares;
        _totalShares += shares;
        emit Transfer(address(0), to, amount);
    }

    function setMultiplier(uint256 newMultiplier) external {
        require(newMultiplier > 0, "zero multiplier");
        multiplier = newMultiplier;
    }

    function totalSupply() external view override returns (uint256) {
        return (_totalShares * multiplier) / 1e18;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return (_shares[account] * multiplier) / 1e18;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transferShares(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transferShares(from, to, amount);
        return true;
    }

    function _transferShares(address from, address to, uint256 amount) internal {
        uint256 shares = (amount * 1e18 + multiplier - 1) / multiplier;
        require(_shares[from] >= shares, "insufficient balance");
        _shares[from] -= shares;
        _shares[to] += shares;
        emit Transfer(from, to, amount);
    }
}
