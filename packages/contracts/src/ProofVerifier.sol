// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofVerifier} from "./interfaces/IProofVerifier.sol";
import {ICSCAMerkleTree} from "./interfaces/ICSCAMerkleTree.sol";

interface IUltraHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

// hashed_address in the circuit is a BN254 field element. On-chain, keccak256(msg.sender) is a
// 256-bit value that exceeds the BN254 prime ~81% of the time. The Mopro prover reduces it mod p,
// so the verifier must do the same or the Fiat-Shamir transcript will diverge (SumcheckFailed).
uint256 constant BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

/// @title ProofVerifier
/// @notice Delegates ZK proof verification to generated Noir UltraHonk verifier contracts.
/// @dev Marshals typed public inputs into the bytes32[] array expected by the generated
///      verifiers, preserving the circuit's declaration order.
///
///      Base circuit public inputs:    [epoch_nullifier, hashed_address, csca_merkle_root]
///      Primary circuit public inputs: [nullifier, hashed_address, csca_merkle_root]
///
///      The CSCA Merkle root is fetched from the on-chain CSCAMerkleTree contract and
///      passed as a public input to the circuit. The circuit verifies that the DSC
///      public key is included in the ICAO Merkle tree.

contract ProofVerifier is IProofVerifier {
    IUltraHonkVerifier public immutable i_baseVerifier;
    IUltraHonkVerifier public immutable i_primaryVerifier;
    ICSCAMerkleTree public immutable i_cscaMerkleTree;

    constructor(address baseVerifier, address primaryVerifier, address cscaMerkleTree_) {
        i_baseVerifier = IUltraHonkVerifier(baseVerifier);
        i_primaryVerifier = IUltraHonkVerifier(primaryVerifier);
        i_cscaMerkleTree = ICSCAMerkleTree(cscaMerkleTree_);
    }

    /// @inheritdoc IProofVerifier
    function verifyBaseProof(
        bytes32 hashedAddress,
        bytes32 epochNullifier,
        bytes32 cscaMerkleRoot,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = epochNullifier;
        publicInputs[1] = bytes32(uint256(hashedAddress) % BN254_PRIME);
        publicInputs[2] = cscaMerkleRoot;
        return i_baseVerifier.verify(proof, publicInputs);
    }

    /// @inheritdoc IProofVerifier
    function verifyPrimaryProof(
        bytes32 hashedAddress,
        bytes32 nullifier,
        bytes32 cscaMerkleRoot,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = nullifier;
        publicInputs[1] = bytes32(uint256(hashedAddress) % BN254_PRIME);
        publicInputs[2] = cscaMerkleRoot;
        return i_primaryVerifier.verify(proof, publicInputs);
    }
}
