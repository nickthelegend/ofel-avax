// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DemoPool — a minimal public AMM for Ofel's sandwich-attack demo.
/// @notice DEMO ONLY. A Uniswap-v2-style constant-product pool (x*y=k, 0.3% fee) with no LP shares, deployed on a
///         local Anvil fork of the Fuji C-Chain to show what a mempool-reading bot does to a public swap. It is not
///         part of Ofel and never holds real value. Swaps are public calldata (token in, amount in, min out), so
///         anyone watching the mempool can read the size and side of a pending trade before it lands.
contract DemoPool {
    IERC20 public immutable token0; // tAVAX
    IERC20 public immutable token1; // tUSDC
    uint256 public reserve0;
    uint256 public reserve1;

    event Seeded(uint256 reserve0, uint256 reserve1);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to, uint256 reserve0, uint256 reserve1);

    error BadToken();
    error ZeroAmount();
    error Slippage(uint256 out, uint256 minOut);

    constructor(IERC20 token0_, IERC20 token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    /// Adds liquidity at any ratio (demo: the deployer seeds it once).
    function seed(uint256 amount0, uint256 amount1) external {
        token0.transferFrom(msg.sender, address(this), amount0);
        token1.transferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
        emit Seeded(reserve0, reserve1);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        (uint256 rIn, uint256 rOut) = _reserves(tokenIn);
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * rOut) / (rIn * 1000 + inWithFee);
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        amountOut = getAmountOut(tokenIn, amountIn);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        bool zeroIn = tokenIn == address(token0);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        (zeroIn ? token1 : token0).transfer(to, amountOut);
        if (zeroIn) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to, reserve0, reserve1);
    }

    function _reserves(address tokenIn) internal view returns (uint256 rIn, uint256 rOut) {
        if (tokenIn == address(token0)) return (reserve0, reserve1);
        if (tokenIn == address(token1)) return (reserve1, reserve0);
        revert BadToken();
    }
}
