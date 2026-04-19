// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IProofVerifier
/// @notice Interface for ZK proof verification. Implemented as a separate contract so the
///         verifier can be swapped when the circuit is upgraded (e.g. stub → real Noir verifier)
///         without redeploying VerificationRegistry.
///
/// @dev Base and primary tiers have different public inputs, so they get separate functions.
///      The registry is responsible for checking that hashedAddress == keccak256(msg.sender);
///      the verifier only validates the cryptographic proof.
///
///      Public inputs per tier:
///
///      Base:    [epochNullifier, hashedAddress, cscaMerkleRoot]
///      Primary: [nullifier, nextCommitment, hashedAddress, cscaMerkleRoot]
///
///      Note: passportExpiry is NOT a circuit input — it's checked on-chain before verification.
interface IProofVerifier {
    /// @notice Verify a base-tier registration or renewal proof.
    /// @param hashedAddress keccak256(abi.encodePacked(wallet)) — binds proof to registering wallet.
    /// @param epochNullifier Rate-limiting nullifier: hash(s, "epoch", day). Zero for renewals.
    /// @param cscaMerkleRoot CSCA Merkle root from on-chain registry — binds proof to current ICAO ML.
    /// @param proof Raw proof bytes (format determined by proving system).
    function verifyBaseProof(
        bytes32 hashedAddress,
        bytes32 epochNullifier,
        bytes32 cscaMerkleRoot,
        bytes calldata proof
    ) external view returns (bool);

    /// @notice Verify a primary-tier registration, renewal, or primary-change proof.
    /// @param hashedAddress keccak256(abi.encodePacked(wallet)) — binds proof to registering wallet.
    /// @param nullifier Permanent primary nullifier: hash(s, nonce). Unique per registration slot.
    /// @param nextCommitment Commitment to next nullifier: hash(hash(s, nonce+1)).
    /// @param cscaMerkleRoot CSCA Merkle root from on-chain registry — binds proof to current ICAO ML.
    function verifyPrimaryProof(
        bytes32 hashedAddress,
        bytes32 nullifier,
        bytes32 nextCommitment,
        bytes32 cscaMerkleRoot,
        bytes calldata proof
    ) external view returns (bool);
}
