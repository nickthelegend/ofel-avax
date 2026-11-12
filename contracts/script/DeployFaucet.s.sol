// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OfelFaucet} from "../src/OfelFaucet.sol";
import {OfelTestToken} from "../src/tokens/OfelTestToken.sol";

/// Deploys the judge faucet on the Ofel L1 and stocks it for OFEL_FAUCET_DRIPS wallets.
/// Env: OFEL_DEPLOYER_PK (owner of the test tokens), OFEL_FAUCET_OPERATOR, OFEL_TAVAX, OFEL_TUSDC, OFEL_FAUCET_DRIPS.
contract DeployFaucet is Script {
    uint256 constant GAS = 5 ether; // OFEL: gas for setup, sealing and settlement, plus the 0.1 bond
    uint256 constant AVAX = 2_000 ether; // tAVAX, 18 decimals
    uint256 constant USDC = 50_000e6; // tUSDC, 6 decimals

    function run() external {
        uint256 pk = vm.envUint("OFEL_DEPLOYER_PK");
        uint256 n = vm.envUint("OFEL_FAUCET_DRIPS");
        OfelTestToken tAVAX = OfelTestToken(vm.envAddress("OFEL_TAVAX"));
        OfelTestToken tUSDC = OfelTestToken(vm.envAddress("OFEL_TUSDC"));
        vm.startBroadcast(pk);
        OfelFaucet f = new OfelFaucet(vm.addr(pk), vm.envAddress("OFEL_FAUCET_OPERATOR"), IERC20(address(tAVAX)), IERC20(address(tUSDC)), GAS, AVAX, USDC);
        tAVAX.mint(address(f), AVAX * n);
        tUSDC.mint(address(f), USDC * n);
        (bool ok,) = address(f).call{value: GAS * n}("");
        require(ok, "stock OFEL");
        vm.stopBroadcast();
        console2.log("OfelFaucet", address(f));
    }
}
