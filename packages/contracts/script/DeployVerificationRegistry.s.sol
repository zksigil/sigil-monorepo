// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";

/**
 * @notice Deployment script for VerificationRegistry on Base Sepolia.
 *
 * Usage:
 *   forge script script/DeployVerificationRegistry.s.sol:DeployVerificationRegistry \
 *     --rpc-url base_sepolia \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * Prerequisites:
 *   export PRIVATE_KEY=<deployer_private_key>
 *   export DEPLOYER_ADDRESS=<deployer_address>
 *   export BASE_SEPOLIA_RPC_URL=<rpc_url>
 *   export BASESCAN_API_KEY=<api_key>
 */
contract DeployVerificationRegistry is Script {
    function run() public returns (VerificationRegistry registry) {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        console2.log("Deploying VerificationRegistry...");
        console2.log("Deployer:   ", deployer);
        console2.log("Chain ID:   ", block.chainid);

        vm.startBroadcast();
        registry = new VerificationRegistry(deployer);
        vm.stopBroadcast();

        console2.log("VerificationRegistry deployed at:", address(registry));
        console2.log("Owner:", registry.owner());
        console2.log("Group size:", registry.getGroupSize());
        console2.log("ZK Verifier (Phase 1 = address(0)):", registry.getZkVerifier());

        // After deployment, update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env
    }
}
