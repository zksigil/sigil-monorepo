// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {ProofVerifier} from "../src/ProofVerifier.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";
import {BaseUltraHonkVerifier} from "../src/verifiers/BaseUltraHonkVerifier.sol";
import {PrimaryUltraHonkVerifier} from "../src/verifiers/PrimaryUltraHonkVerifier.sol";

/// @notice Full deployment script for Sigil contracts on Sepolia / Ethereum Mainnet.
///
/// Prerequisites:
///   export PRIVATE_KEY=<deployer_private_key>
///   export DEPLOYER_ADDRESS=<deployer_address>
///   export SEPOLIA_RPC_URL=<rpc_url>
///   export ETHERSCAN_API_KEY=<api_key>
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url sepolia --broadcast --verify -vvvv
///
/// After deployment:
///   Update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env
contract Deploy is Script {
    // CSCA Merkle root from certs/tree-root.ts (269 certs, depth 12)
    bytes32 public constant CSCA_MERKLE_ROOT = 0x06db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de;

    function run()
        public
        returns (
            ProtocolConfig config,
            ProofVerifier verifier,
            CSCAMerkleTree cscaTree,
            VerificationRegistry registry
        )
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

        // 2. CSCAMerkleTree — stores ICAO CSCA Merkle root, deployer is initial owner
        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, deployer);
        console2.log("CSCAMerkleTree:       ", address(cscaTree));
        console2.logBytes32(CSCA_MERKLE_ROOT);

        // 3. UltraHonk verifiers (generated from Noir circuits)
        BaseUltraHonkVerifier baseHonk = new BaseUltraHonkVerifier();
        console2.log("BaseUltraHonkVerifier:", address(baseHonk));

        PrimaryUltraHonkVerifier primaryHonk = new PrimaryUltraHonkVerifier();
        console2.log("PrimaryUltraHonkVerifier:", address(primaryHonk));

        // 4. ProofVerifier — marshals typed inputs and delegates to UltraHonk verifiers
        verifier = new ProofVerifier(
            address(baseHonk),
            address(primaryHonk),
            address(cscaTree)
        );
        console2.log("ProofVerifier:        ", address(verifier));

        // 5. VerificationRegistry
        registry = new VerificationRegistry(deployer, config, verifier, address(cscaTree));
        console2.log("VerificationRegistry: ", address(registry));

        vm.stopBroadcast();

        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env");
        console2.log("  2. Deploy TimelockController and call registry.transferGovernance(timelock)");
    }
}
