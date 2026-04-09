// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProofVerifier} from "../../src/interfaces/IProofVerifier.sol";

/// @notice Configurable mock verifier for tests.
///         Defaults to returning true. Set shouldReject = true to simulate invalid proofs.
contract MockProofVerifier is IProofVerifier {
    bool public shouldReject;
    bool public shouldRevert;

    function setReject(bool _reject) external {
        shouldReject = _reject;
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function verifyBaseProof(
        bytes32,
        uint48,
        bytes32,
        bytes32,
        bytes calldata
    ) external view override returns (bool) {
        if (shouldRevert) revert("MockProofVerifier: forced revert");
        return !shouldReject;
    }

    function verifyPrimaryProof(
        bytes32,
        uint48,
        bytes32,
        bytes32,
        bytes32,
        bytes calldata
    ) external view override returns (bool) {
        if (shouldRevert) revert("MockProofVerifier: forced revert");
        return !shouldReject;
    }
}
