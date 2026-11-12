// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OfelBook} from "../src/OfelBook.sol";
import {OfelTestToken} from "../src/tokens/OfelTestToken.sol";
import {EncryptedERC} from "../src/vendor/eerc/EncryptedERC.sol";
import {Registrar} from "../src/vendor/eerc/Registrar.sol";
import {RegistrationVerifier} from "../src/vendor/eerc/prod/RegistrationVerifier.sol";
import {MintVerifier} from "../src/vendor/eerc/prod/MintVerifier.sol";
import {WithdrawVerifier} from "../src/vendor/eerc/prod/WithdrawVerifier.sol";
import {TransferVerifier} from "../src/vendor/eerc/prod/TransferVerifier.sol";
import {BurnVerifier} from "../src/vendor/eerc/prod/BurnVerifier.sol";
import {CreateEncryptedERCParams} from "../src/vendor/eerc/types/Types.sol";

/// Deploys the Ofel stack on the Ofel L1: test assets, Ava Labs eERC (converter mode, prod
/// verifiers) with its Registrar, and the OfelBook. Env: OFEL_DEPLOYER_PK, OFEL_AGENT_ADDRESS,
/// OFEL_AGENT_X25519 (bytes32), OFEL_BOND_WEI, OFEL_REVEAL_WINDOW, OFEL_SETTLE_WINDOW, OFEL_OUT.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("OFEL_DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address agent = vm.envAddress("OFEL_AGENT_ADDRESS");
        bytes32 agentKey = vm.envBytes32("OFEL_AGENT_X25519");
        vm.startBroadcast(pk);

        OfelTestToken oavax = new OfelTestToken("Ofel Test AVAX", "tAVAX", 18, deployer);
        OfelTestToken ousdc = new OfelTestToken("Ofel Test USDC", "tUSDC", 6, deployer);

        Registrar registrar = new Registrar(address(new RegistrationVerifier()));
        EncryptedERC eerc = new EncryptedERC(
            CreateEncryptedERCParams({
                registrar: address(registrar),
                isConverter: true,
                name: "",
                symbol: "",
                decimals: 2,
                mintVerifier: address(new MintVerifier()),
                withdrawVerifier: address(new WithdrawVerifier()),
                transferVerifier: address(new TransferVerifier()),
                burnVerifier: address(new BurnVerifier())
            })
        );
        OfelBook book = new OfelBook(
            agent, agentKey, vm.envUint("OFEL_BOND_WEI"), uint64(vm.envUint("OFEL_REVEAL_WINDOW")), uint64(vm.envUint("OFEL_SETTLE_WINDOW"))
        );
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeAddress(o, "deployer", deployer);
        vm.serializeAddress(o, "agent", agent);
        vm.serializeAddress(o, "tAVAX", address(oavax));
        vm.serializeAddress(o, "tUSDC", address(ousdc));
        vm.serializeAddress(o, "registrar", address(registrar));
        vm.serializeAddress(o, "encryptedERC", address(eerc));
        string memory json = vm.serializeAddress(o, "ofelBook", address(book));
        vm.writeJson(json, vm.envString("OFEL_OUT"));
        console2.log("OfelBook", address(book));
        console2.log("EncryptedERC", address(eerc));
    }
}
