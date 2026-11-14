// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OfelBook} from "../src/OfelBook.sol";
import {OfelTestToken} from "../src/tokens/OfelTestToken.sol";

/// Two more markets on the Ofel L1: tBTC/tUSDC and tETH/tUSDC. Each market is its own OfelBook (same agent, bond and
/// windows as the tAVAX book) with its own test base asset; settlement uses the same eERC converter, which registers a
/// new token on its first deposit. The agent sets each book's x25519 key itself on start (key derived per book).
contract DeployMarkets is Script {
    function run() external {
        uint256 pk = vm.envUint("OFEL_DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address agent = vm.envAddress("OFEL_AGENT_ADDRESS");
        address house = vm.envAddress("OFEL_HOUSE_ADDRESS");
        OfelTestToken usdc = OfelTestToken(vm.envAddress("OFEL_TUSDC"));
        uint256 bond = vm.envUint("OFEL_BOND_WEI");
        uint64 rw = uint64(vm.envUint("OFEL_REVEAL_WINDOW"));
        uint64 sw = uint64(vm.envUint("OFEL_SETTLE_WINDOW"));
        vm.startBroadcast(pk);
        OfelTestToken tbtc = new OfelTestToken("Ofel Test BTC", "tBTC", 8, deployer);
        OfelTestToken teth = new OfelTestToken("Ofel Test ETH", "tETH", 18, deployer);
        OfelBook btcBook = new OfelBook(agent, bytes32(uint256(1)), bond, rw, sw);
        OfelBook ethBook = new OfelBook(agent, bytes32(uint256(1)), bond, rw, sw);
        // House inventory for quoting both sides of the new markets (test assets, no value).
        tbtc.mint(house, 20e8);
        teth.mint(house, 600e18);
        usdc.mint(house, 400_000e6);
        vm.stopBroadcast();

        string memory o = "markets";
        vm.serializeAddress(o, "tBTC", address(tbtc));
        vm.serializeAddress(o, "tETH", address(teth));
        vm.serializeAddress(o, "btcBook", address(btcBook));
        string memory json = vm.serializeAddress(o, "ethBook", address(ethBook));
        vm.writeJson(json, vm.envString("OFEL_OUT"));
        console2.log("tBTC book", address(btcBook));
        console2.log("tETH book", address(ethBook));
    }
}
