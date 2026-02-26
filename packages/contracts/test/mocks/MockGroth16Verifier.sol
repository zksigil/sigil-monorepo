// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGroth16Verifier} from "../../src/interfaces/IGroth16Verifier.sol";

/// @title MockGroth16Verifier
/// @notice A mock Groth16 verifier for testing VerificationRegistry.
/// @dev By default all proofs pass. Call `setShouldRevert` or `setReturnValue` to
///      simulate failure modes.
contract MockGroth16Verifier is IGroth16Verifier {
    bool private s_shouldRevert;
    bool private s_returnValue = true;
    string private s_revertReason = "mock verifier revert";

    uint256 public lastCallPublicSignalsLength;
    bytes public lastCallProof;

    function setShouldRevert(bool shouldRevert) external {
        s_shouldRevert = shouldRevert;
    }

    function setReturnValue(bool returnValue) external {
        s_returnValue = returnValue;
    }

    function setRevertReason(string calldata reason) external {
        s_revertReason = reason;
    }

    /// @inheritdoc IGroth16Verifier
    function verifyProof(
        bytes calldata proof,
        uint256[] calldata publicSignals
    ) external view override returns (bool valid) {
        // Silence unused variable warnings in a view context by reading them
        // (storage writes aren't possible in view, so we just validate)
        if (proof.length == 0 && publicSignals.length == 0) {
            // Will never reach here with real usage but satisfies compiler
        }

        if (s_shouldRevert) {
            revert(s_revertReason);
        }
        return s_returnValue;
    }
}
