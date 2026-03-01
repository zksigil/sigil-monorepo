// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGroth16Verifier} from "../../src/interfaces/IGroth16Verifier.sol";

/// @title MockGroth16Verifier
/// @notice A mock ZK proof verifier for testing VerificationRegistry.
/// @dev By default all proofs pass. Call `setShouldRevert` or `setReturnValue` to
///      simulate failure modes.
contract MockGroth16Verifier is IGroth16Verifier {
    bool private s_shouldRevert;
    bool private s_returnValue = true;
    string private s_revertReason = "mock verifier revert";

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
        bytes calldata,
        uint256[] calldata
    ) external view override returns (bool valid) {
        if (s_shouldRevert) {
            revert(s_revertReason);
        }
        return s_returnValue;
    }
}
