// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {MockProofVerifier} from "../test/mocks/MockProofVerifier.sol";

/// @notice Dev deployment using MockProofVerifier (always accepts proofs).
///         For local anvil testing only — stub proofs from the app will pass.
///
/// Usage:
///   anvil --host 0.0.0.0
///   forge script script/DeployDev.s.sol:DeployDev \
///     --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployDev is Script {
    function run() public returns (ProtocolConfig config, MockProofVerifier verifier, VerificationRegistry registry) {
        address deployer = msg.sender;

        console2.log("=== Sigil Dev Deployment (MockProofVerifier) ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast();

        config = new ProtocolConfig(deployer);
        console2.log("ProtocolConfig:       ", address(config));

        verifier = new MockProofVerifier();
        console2.log("MockProofVerifier:    ", address(verifier));

        registry = new VerificationRegistry(deployer, config, verifier);
        console2.log("VerificationRegistry: ", address(registry));

        vm.stopBroadcast();

        console2.log("");
        console2.log("Update contracts.ts anvil address to:", address(registry));
    }
}
