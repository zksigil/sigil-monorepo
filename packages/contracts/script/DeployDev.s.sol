// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SigilRegistry} from "../src/SigilRegistry.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";
import {MockUltraHonkVerifier} from "../test/mocks/MockUltraHonkVerifier.sol";

/// @notice Dev deployment using MockUltraHonkVerifier (always accepts proofs).
///         For local anvil testing only — stub proofs from the app will pass.
///
/// Usage:
///   anvil --host 0.0.0.0
///   forge script script/DeployDev.s.sol:DeployDev \
///     --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployDev is Script {
    // CSCA Merkle root — must match certs/tree-root.ts (built by certs/build-tree.ts)
    bytes32 public constant CSCA_MERKLE_ROOT = 0x2d656797b947d09105dcde4480bde0e03e9b7e6b02984c40d6391a91835580ef;

    uint256 public constant REGISTRATION_TTL = 180 days;
    uint8 public constant MAX_DAILY_REGISTRATIONS = 10;

    function run() public returns (
        MockUltraHonkVerifier verifier,
        CSCAMerkleTree cscaTree,
        SigilRegistry registry
    ) {
        address deployer = msg.sender;

        console2.log("=== Sigil Dev Deployment (MockUltraHonkVerifier) ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast();

        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, deployer);
        console2.log("CSCAMerkleTree:       ", address(cscaTree));

        verifier = new MockUltraHonkVerifier();
        console2.log("MockUltraHonkVerifier:", address(verifier));

        registry = new SigilRegistry(
            verifier,
            address(cscaTree),
            REGISTRATION_TTL,
            MAX_DAILY_REGISTRATIONS
        );
        console2.log("SigilRegistry: ", address(registry));

        vm.stopBroadcast();

        console2.log("");
        console2.log("Update contracts.ts anvil address to:", address(registry));
    }
}
