// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

interface IUltraHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

// hashed_address in the circuit is a BN254 field element. On-chain, keccak256(msg.sender) is a
// 256-bit value that exceeds the BN254 prime ~81% of the time. The Mopro prover reduces it mod p,
// so the verifier must do the same or the Fiat-Shamir transcript will diverge (SumcheckFailed).
uint256 constant BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

/// @title ProofVerifier
/// @notice Delegates ZK proof verification to the generated Noir UltraHonk verifier.
/// @dev Marshals typed public inputs into the bytes32[] array expected by the generated
///      verifier, preserving the circuit's declaration order.
///
///      Sigil circuit public inputs: [nullifier, epochNullifier, hashed_address, csca_merkle_root]
contract ProofVerifier is IProofVerifier {
    IUltraHonkVerifier public immutable i_verifier;

    constructor(address verifier_) {
        i_verifier = IUltraHonkVerifier(verifier_);
    }

    /// @inheritdoc IProofVerifier
    function verifyProof(
        bytes32 hashedAddress,
        bytes32 nullifier,
        bytes32 epochNullifier,
        bytes32 cscaMerkleRoot,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = nullifier;
        publicInputs[1] = epochNullifier;
        publicInputs[2] = bytes32(uint256(hashedAddress) % BN254_PRIME);
        publicInputs[3] = cscaMerkleRoot;
        return i_verifier.verify(proof, publicInputs);
    }
}
