// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IProofVerifier
/// @notice Interface for ZK proof verification. Implemented as a separate contract so the
///         verifier can be swapped when the circuit is upgraded (e.g. mock → real Noir verifier)
///         without redeploying VerificationRegistry.
///
/// @dev The registry is responsible for checking that hashedAddress == keccak256(msg.sender);
///      the verifier only validates the cryptographic proof.
///
///      Public inputs to the circuit (in declaration order):
///        [nullifier, epochNullifier, hashedAddress, cscaMerkleRoot]
///
///      `epochNullifier` is `bytes32(0)` for renewals — the contract skips daily rate limiting
///      on renewals, and the circuit allows zero in that slot.
///      `passportExpiry` is NOT a circuit input — it's checked on-chain before verification.
interface IProofVerifier {
    /// @notice Verify a sigil registration or renewal proof.
    /// @param hashedAddress   keccak256(abi.encodePacked(wallet)) — binds proof to registering wallet.
    /// @param nullifier       Stable per-passport nullifier (Poseidon2(s, 1)).
    /// @param epochNullifier  Daily-rate-limit nullifier: hash(s, "epoch", day). Zero on renewals.
    /// @param cscaMerkleRoot  CSCA Merkle root from on-chain registry — binds proof to current ICAO ML.
    /// @param proof           Raw proof bytes (format determined by proving system).
    function verifyProof(
        bytes32 hashedAddress,
        bytes32 nullifier,
        bytes32 epochNullifier,
        bytes32 cscaMerkleRoot,
        bytes calldata proof
    ) external view returns (bool);
}
