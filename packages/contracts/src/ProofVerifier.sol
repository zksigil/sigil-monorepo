// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

/// @title ProofVerifier (Stub)
/// @notice Stub implementation of IProofVerifier that accepts all proofs.
/// @dev DEVELOPMENT USE ONLY. Replace with the real Noir UltraHonk verifier once
///      the circuit is written and the proving key is generated.
///
///      The real verifier will verify that:
///        - The prover knows a passport secret s such that:
///            hashedAddress = keccak256(wallet)              (base + primary)
///            passportExpiry is correctly read from DG1      (base + primary)
///            epochNullifier = hash(s, "epoch", currentDay)  (base only)
///            nullifier = hash(s, nonce)                     (primary only)
///            nextCommitment = hash(hash(s, nonce+1))        (primary only)
///        - block.timestamp < passportExpiry (asserted in circuit)
contract ProofVerifier is IProofVerifier {
    /// @inheritdoc IProofVerifier
    function verifyBaseProof(
        bytes32, /* hashedAddress */
        uint48, /* passportExpiry */
        bytes32, /* epochNullifier */
        bytes calldata /* proof */
    ) external pure override returns (bool) {
        return true;
    }

    /// @inheritdoc IProofVerifier
    function verifyPrimaryProof(
        bytes32, /* hashedAddress */
        uint48, /* passportExpiry */
        bytes32, /* nullifier */
        bytes32, /* nextCommitment */
        bytes calldata /* proof */
    ) external pure override returns (bool) {
        return true;
    }
}
