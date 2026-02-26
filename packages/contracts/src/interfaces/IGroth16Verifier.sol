// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IGroth16Verifier
/// @notice Interface for Groth16 ZK proof verification used by VerificationRegistry.
/// @dev The verifier contract is expected to validate a zkPassport proof that binds
///      a passport nullifier to the caller's wallet address and Semaphore commitment.
///
///      Proof layout (ABI-encoded in `zkProof` bytes):
///        - uint256[2] a   — G1 point (π_A)
///        - uint256[2][2] b — G2 point (π_B)
///        - uint256[2] c   — G1 point (π_C)
///
///      Public signals array layout:
///        [0] nullifier
///        [1] semaphoreIdentityCommitment
///        [2] uint256(uint160(walletAddress))
interface IGroth16Verifier {
    /// @notice Verify a Groth16 proof against the given public signals.
    /// @param proof ABI-encoded proof elements (a, b, c).
    /// @param publicSignals The public inputs to the circuit.
    /// @return valid True if the proof is valid for the given public signals.
    function verifyProof(
        bytes calldata proof,
        uint256[] calldata publicSignals
    ) external view returns (bool valid);
}
