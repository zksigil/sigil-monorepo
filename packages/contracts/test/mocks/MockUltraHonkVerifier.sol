// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUltraHonkVerifier} from "../../src/VerificationRegistry.sol";

/// @notice Configurable mock UltraHonk verifier for tests and the dev anvil deployment.
///         Defaults to returning true. Set `shouldReject = true` to simulate invalid proofs.
contract MockUltraHonkVerifier is IUltraHonkVerifier {
    bool public shouldReject;
    bool public shouldRevert;

    function setReject(bool _reject) external {
        shouldReject = _reject;
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function verify(bytes calldata, bytes32[] calldata) external view override returns (bool) {
        if (shouldRevert) revert("MockUltraHonkVerifier: forced revert");
        return !shouldReject;
    }
}
