// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IProofVerifier
/// @notice Interface for ZK proof verification. Implemented as a separate contract so the
///         verifier can be swapped when the circuit is upgraded (e.g. stub → real Noir verifier)
///         without redeploying VerificationRegistry.
///
/// @dev Base and primary tiers have different public inputs, so they get separate functions.
///      The registry is responsible for checking that hashedAddress == keccak256(msg.sender);
///      the verifier only validates the cryptographic proof.
///
///      Current stub implementation accepts all proofs. The real implementation will verify
///      a Noir UltraHonk proof with the following public inputs per tier:
///
///      Base:    [hashedAddress, passportExpiry, epochNullifier]
///      Primary: [hashedAddress, passportExpiry, nullifier, nextCommitment]
interface IProofVerifier {
    /// @notice Verify a base-tier registration or renewal proof.
    /// @param hashedAddress keccak256(abi.encodePacked(wallet)) — binds proof to registering wallet.
    /// @param passportExpiry Expiry timestamp from DG1, asserted < block.timestamp in circuit.
    /// @param epochNullifier Rate-limiting nullifier: hash(s, "epoch", day). Zero for renewals.
    /// @param proof Raw proof bytes (format determined by proving system).
    function verifyBaseProof(
        bytes32 hashedAddress,
        uint48 passportExpiry,
        bytes32 epochNullifier,
        bytes calldata proof
    ) external view returns (bool);

    /// @notice Verify a primary-tier registration, renewal, or primary-change proof.
    /// @param hashedAddress keccak256(abi.encodePacked(wallet)) — binds proof to registering wallet.
    /// @param passportExpiry Expiry timestamp from DG1.
    /// @param nullifier Permanent primary nullifier: hash(s, nonce). Unique per registration slot.
    /// @param nextCommitment Commitment to next nullifier: hash(hash(s, nonce+1)).
    function verifyPrimaryProof(
        bytes32 hashedAddress,
        uint48 passportExpiry,
        bytes32 nullifier,
        bytes32 nextCommitment,
        bytes calldata proof
    ) external view returns (bool);
}
