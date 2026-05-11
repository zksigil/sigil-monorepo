// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SigilRegistry, IUltraHonkVerifier} from "../src/SigilRegistry.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";
import {SigilUltraHonkVerifier} from "../src/verifiers/SigilUltraHonkVerifier.sol";

/// @notice Full deployment script for Sigil contracts on Base Sepolia / Base mainnet.
///
/// The registry is immutable after deploy: no governor, no setters, no pause.
/// The only ongoing privileged action in the system is rotating the CSCA Merkle root,
/// which lives on `CSCAMerkleTree` (Ownable2Step). Initial owner is the deployer
/// (resolved from `msg.sender`); transfer to a multisig / TimelockController
/// immediately after deployment.
///
/// Prerequisites:
///   - A Foundry keystore created via `cast wallet import` (e.g. `cast wallet import
///     base_sepolia --interactive`). The keystore lives at ~/.foundry/keystores/<name>
///     and is encrypted with a password — no raw private keys in env vars or shell history.
///   - export BASE_SEPOLIA_RPC_URL=<rpc_url>     # for testnet
///   - export BASE_RPC_URL=<rpc_url>             # for mainnet
///
/// Usage (Base Sepolia testnet):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base_sepolia --account base_sepolia --broadcast -vvvv
///
/// Usage (Base mainnet):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base --account base_mainnet --broadcast -vvvv
///
/// Dry-run (simulate without broadcasting):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base_sepolia --sender <your_keystore_address> -vvvv
///
/// Optional Basescan source verification: append `--verify` and `export BASESCAN_API_KEY=...`
/// (free key at https://basescan.org/myapikey). Verification adds Solidity source on
/// Basescan — purely cosmetic for end users; integrators reading bytecode don't need it.
///
/// After deployment:
///   1. Update EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS (or EXPO_PUBLIC_BASE_REGISTRY_ADDRESS)
///      in BOTH root .env and apps/mobile/.env, then rebuild the app — Expo bakes env
///      vars into the JS bundle at build time, and the root .env feeds Makefile targets.
///   2. Transfer CSCAMerkleTree ownership to a multisig via transferOwnership() →
///      acceptOwnership(). See CLAUDE.md "Production deploy procedure" for details.
contract Deploy is Script {
    // CSCA Merkle root from certs/tree-root.ts (269 certs, depth 9)
    bytes32 public constant CSCA_MERKLE_ROOT = 0x2d656797b947d09105dcde4480bde0e03e9b7e6b02984c40d6391a91835580ef;

    // Registry parameters — bounded by hard limits in SigilRegistry's constructor.
    uint256 public constant REGISTRATION_TTL = 180 days;
    uint8 public constant MAX_DAILY_REGISTRATIONS = 10;

    function run()
        public
        returns (
            SigilUltraHonkVerifier verifier,
            CSCAMerkleTree cscaTree,
            SigilRegistry registry
        )
    {
        // Forge sets msg.sender from --account / --sender, so this resolves to the
        // keystore-derived address with no DEPLOYER_ADDRESS env var needed.
        address deployer = msg.sender;

        console2.log("=== Sigil Deployment ===");
        console2.log("Deployer:  ", deployer);
        console2.log("Chain ID:  ", block.chainid);

        vm.startBroadcast();

        // 1. CSCAMerkleTree — stores ICAO CSCA Merkle root, deployer is initial owner.
        //    Transfer ownership to a multisig via transferOwnership() after deployment.
        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, deployer);
        console2.log("CSCAMerkleTree:       ", address(cscaTree));
        console2.logBytes32(CSCA_MERKLE_ROOT);

        // 2. UltraHonk verifier — single verifier for the unified sigil circuit. The
        //    registry talks to it directly via the IUltraHonkVerifier surface; public-input
        //    marshalling and BN254 reduction live inside the registry.
        verifier = new SigilUltraHonkVerifier();
        console2.log("UltraHonk verifier:   ", address(verifier));

        // 3. SigilRegistry — immutable after this constructor returns.
        //    Cast is required because the generated SigilUltraHonkVerifier doesn't declare
        //    the IUltraHonkVerifier interface, but its `verify` signature matches.
        registry = new SigilRegistry(
            IUltraHonkVerifier(address(verifier)),
            address(cscaTree),
            REGISTRATION_TTL,
            MAX_DAILY_REGISTRATIONS
        );
        console2.log("SigilRegistry: ", address(registry));
        console2.log("  registrationTTL:    ", REGISTRATION_TTL / 1 days, "days");
        console2.log("  maxDailyRegs:       ", MAX_DAILY_REGISTRATIONS);

        vm.stopBroadcast();

        console2.log("");
        console2.log("Next steps:");
        if (block.chainid == 84532) {
            console2.log("  1. Update EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS in apps/mobile/.env");
        } else if (block.chainid == 8453) {
            console2.log("  1. Update EXPO_PUBLIC_BASE_REGISTRY_ADDRESS in apps/mobile/.env");
        } else {
            console2.log("  1. Update the registry address in apps/mobile/.env for chain", block.chainid);
        }
        console2.log("  2. Transfer CSCAMerkleTree ownership to a multisig:");
        console2.log("       cast send <CSCATree> 'transferOwnership(address)' <newOwner> \\");
        console2.log("         --account base_sepolia --rpc-url base_sepolia");
        console2.log("       cast send <CSCATree> 'acceptOwnership()' \\");
        console2.log("         --account <newOwnerAccount> --rpc-url base_sepolia");
    }
}
