// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProofVerifier} from "../src/ProofVerifier.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";
import {SigilUltraHonkVerifier} from "../src/verifiers/SigilUltraHonkVerifier.sol";

/// @notice Full deployment script for Sigil contracts on Sepolia / Ethereum Mainnet.
///
/// The registry is immutable after deploy: no governor, no setters, no pause.
/// The only ongoing privileged action in the system is rotating the CSCA Merkle root,
/// which lives on `CSCAMerkleTree` (Ownable2Step). Initial owner is the deployer;
/// transfer to a multisig / TimelockController immediately after deployment.
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
///   1. Update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env
///   2. Transfer CSCAMerkleTree ownership to a multisig via transferOwnership()
contract Deploy is Script {
    // CSCA Merkle root from certs/tree-root.ts (269 certs, depth 9)
    bytes32 public constant CSCA_MERKLE_ROOT = 0x2d656797b947d09105dcde4480bde0e03e9b7e6b02984c40d6391a91835580ef;

    // Registry parameters — bounded by hard limits in VerificationRegistry's constructor.
    uint256 public constant REGISTRATION_TTL = 180 days;
    uint8 public constant MAX_DAILY_REGISTRATIONS = 10;

    function run()
        public
        returns (
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

        // 1. CSCAMerkleTree — stores ICAO CSCA Merkle root, deployer is initial owner.
        //    Transfer ownership to a multisig via transferOwnership() after deployment.
        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, deployer);
        console2.log("CSCAMerkleTree:       ", address(cscaTree));
        console2.logBytes32(CSCA_MERKLE_ROOT);

        // 2. UltraHonk verifier — single verifier for the unified sigil circuit.
        SigilUltraHonkVerifier honk = new SigilUltraHonkVerifier();
        console2.log("UltraHonk verifier:   ", address(honk));

        // 3. ProofVerifier — marshals typed inputs and delegates to the UltraHonk verifier.
        verifier = new ProofVerifier(address(honk));
        console2.log("ProofVerifier:        ", address(verifier));

        // 4. VerificationRegistry — immutable after this constructor returns.
        registry = new VerificationRegistry(
            verifier,
            address(cscaTree),
            REGISTRATION_TTL,
            MAX_DAILY_REGISTRATIONS
        );
        console2.log("VerificationRegistry: ", address(registry));
        console2.log("  registrationTTL:    ", REGISTRATION_TTL / 1 days, "days");
        console2.log("  maxDailyRegs:       ", MAX_DAILY_REGISTRATIONS);

        vm.stopBroadcast();

        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Update EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env");
        console2.log("  2. Transfer CSCAMerkleTree ownership to a multisig via transferOwnership()");
    }
}
