// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OfelFaucet} from "../src/OfelFaucet.sol";
import {OfelTestToken} from "../src/tokens/OfelTestToken.sol";

contract OfelFaucetTest is Test {
    OfelTestToken avax;
    OfelTestToken usdc;
    OfelFaucet faucet;
    address owner = address(0xA11CE);
    address operator = address(0x0FE1);
    address judge = address(0x1D6E);

    function setUp() public {
        avax = new OfelTestToken("Ofel Test AVAX", "tAVAX", 18, address(this));
        usdc = new OfelTestToken("Ofel Test USDC", "tUSDC", 6, address(this));
        faucet = new OfelFaucet(owner, operator, IERC20(address(avax)), IERC20(address(usdc)), 5 ether, 2_000 ether, 50_000e6);
        avax.mint(address(faucet), 4_000 ether);
        usdc.mint(address(faucet), 100_000e6);
        vm.deal(address(faucet), 10 ether);
    }

    function test_dripFundsANewWalletOnce() public {
        vm.prank(operator);
        faucet.drip(payable(judge));
        assertEq(judge.balance, 5 ether);
        assertEq(avax.balanceOf(judge), 2_000 ether);
        assertEq(usdc.balanceOf(judge), 50_000e6);
        assertTrue(faucet.claimed(judge));
        assertEq(faucet.drips(), 1);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(OfelFaucet.AlreadyClaimed.selector, judge));
        faucet.drip(payable(judge));
    }

    function test_onlyOperatorDrips() public {
        vm.prank(judge);
        vm.expectRevert(OfelFaucet.NotOperator.selector);
        faucet.drip(payable(judge));
    }

    function test_emptyFaucetRevertsWithoutMarkingClaimed() public {
        vm.startPrank(operator);
        faucet.drip(payable(address(0x1)));
        faucet.drip(payable(address(0x2)));
        vm.expectRevert(OfelFaucet.Empty.selector);
        faucet.drip(payable(address(0x3)));
        vm.stopPrank();
        assertFalse(faucet.claimed(address(0x3)));
    }

    function test_ownerSetsOperatorAndSweeps() public {
        vm.prank(judge);
        vm.expectRevert();
        faucet.setOperator(judge);
        vm.prank(owner);
        faucet.setOperator(judge);
        assertEq(faucet.operator(), judge);

        vm.prank(owner);
        faucet.sweep(payable(owner));
        assertEq(owner.balance, 10 ether);
        assertEq(avax.balanceOf(owner), 4_000 ether);
        assertEq(usdc.balanceOf(address(faucet)), 0);
    }
}
