// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {ProofVerifier} from "../src/ProofVerifier.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";

/// @notice Full deployment script for Sigil contracts on Base Sepolia / Base Mainnet.
///
/// Prerequisites:
///   export PRIVATE_KEY=<deployer_private_key>
///   export DEPLOYER_ADDRESS=<deployer_address>
///   export BASE_SEPOLIA_RPC_URL=<rpc_url>
///   export BASESCAN_API_KEY=<api_key>
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base_sepolia --broadcast --verify -vvvv
///
/// After deployment:
///   Update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env
contract Deploy is Script {
    function run()
        public
        returns (ProtocolConfig config, ProofVerifier verifier, VerificationRegistry registry)
    {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        console2.log("=== Sigil Deployment ===");
        console2.log("Deployer:  ", deployer);
        console2.log("Chain ID:  ", block.chainid);

        vm.startBroadcast();

        // 1. ProtocolConfig — governor is the deployer (transfer to Timelock later)
        config = new ProtocolConfig(deployer);
        console2.log("ProtocolConfig:       ", address(config));
        console2.log("  registrationTTL:    ", config.registrationTTL() / 1 days, "days");
        console2.log("  cooldownPeriod:     ", config.cooldownPeriod() / 1 days, "days");
        console2.log("  maxDailyRegistrations:", config.maxDailyRegistrations());

        // 2. ProofVerifier stub — replace with real Noir verifier after circuit is ready
        verifier = new ProofVerifier();
        console2.log("ProofVerifier (stub): ", address(verifier));

        // 3. VerificationRegistry
        registry = new VerificationRegistry(deployer, config, verifier);
        console2.log("VerificationRegistry: ", address(registry));

        vm.stopBroadcast();

        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env");
        console2.log("  2. Deploy TimelockController and call registry.transferGovernance(timelock)");
        console2.log("  3. Replace ProofVerifier stub once Noir circuit is ready");
    }
}
