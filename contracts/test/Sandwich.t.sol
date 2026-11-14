// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoPool} from "../src/sandwich/DemoPool.sol";
import {OfelTestToken} from "../src/tokens/OfelTestToken.sol";

/// The sandwich the demo shows, in one block: bot buys first, victim buys at the worse price, bot sells back.
contract SandwichTest is Test {
    OfelTestToken avax;
    OfelTestToken usdc;
    DemoPool pool;
    address victim = address(0xA11CE);
    address bot = address(0xB07);

    function setUp() public {
        avax = new OfelTestToken("Test AVAX", "tAVAX", 18, address(this));
        usdc = new OfelTestToken("Test USDC", "tUSDC", 18, address(this));
        pool = new DemoPool(avax, usdc);
        avax.mint(address(this), 20_000e18);
        usdc.mint(address(this), 620_000e18);
        avax.approve(address(pool), type(uint256).max);
        usdc.approve(address(pool), type(uint256).max);
        pool.seed(20_000e18, 620_000e18);
        usdc.mint(victim, 31_000e18);
        usdc.mint(bot, 200_000e18);
        vm.prank(victim);
        usdc.approve(address(pool), type(uint256).max);
        vm.startPrank(bot);
        usdc.approve(address(pool), type(uint256).max);
        avax.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_sandwichHurtsVictimAndPaysBot() public {
        uint256 fair = pool.getAmountOut(address(usdc), 31_000e18);

        vm.prank(bot);
        uint256 botAvax = pool.swapExactIn(address(usdc), 9_000e18, 0, bot); // front-run, sized so the victim still clears its 3% limit
        vm.prank(victim);
        uint256 got = pool.swapExactIn(address(usdc), 31_000e18, (fair * 97) / 100, victim); // victim, 3% slippage
        vm.prank(bot);
        uint256 botUsdc = pool.swapExactIn(address(avax), botAvax, 0, bot); // back-run

        assertLt(got, fair, "victim got fewer tAVAX than the fair quote");
        assertGt(botUsdc, 9_000e18, "bot ends with more tUSDC than it started");
        emit log_named_decimal_uint("victim fair tAVAX", fair, 18);
        emit log_named_decimal_uint("victim got tAVAX", got, 18);
        emit log_named_decimal_uint("bot profit tUSDC", botUsdc - 9_000e18, 18);
    }

    function test_slippageLimitStopsAnOversizedFrontRun() public {
        uint256 fair = pool.getAmountOut(address(usdc), 31_000e18);
        vm.prank(bot);
        pool.swapExactIn(address(usdc), 200_000e18, 0, bot);
        vm.prank(victim);
        vm.expectRevert();
        pool.swapExactIn(address(usdc), 31_000e18, (fair * 97) / 100, victim);
    }
}
