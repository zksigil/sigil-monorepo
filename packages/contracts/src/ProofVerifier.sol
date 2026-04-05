// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

interface IUltraHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title ProofVerifier
/// @notice Delegates ZK proof verification to generated Noir UltraHonk verifier contracts.
/// @dev Marshals typed public inputs into the bytes32[] array expected by the generated
///      verifiers, preserving the circuit's declaration order.
///
///      Base circuit public inputs:    [epoch_nullifier, hashed_address, passport_expiry]
///      Primary circuit public inputs: [nullifier, next_commitment, hashed_address, passport_expiry]
contract ProofVerifier is IProofVerifier {
    IUltraHonkVerifier public immutable i_baseVerifier;
    IUltraHonkVerifier public immutable i_primaryVerifier;

    constructor(address baseVerifier, address primaryVerifier) {
        i_baseVerifier = IUltraHonkVerifier(baseVerifier);
        i_primaryVerifier = IUltraHonkVerifier(primaryVerifier);
    }

    /// @inheritdoc IProofVerifier
    function verifyBaseProof(
        bytes32 hashedAddress,
        uint48 passportExpiry,
        bytes32 epochNullifier,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = epochNullifier;
        publicInputs[1] = hashedAddress;
        publicInputs[2] = bytes32(uint256(passportExpiry));
        return i_baseVerifier.verify(proof, publicInputs);
    }

    /// @inheritdoc IProofVerifier
    function verifyPrimaryProof(
        bytes32 hashedAddress,
        uint48 passportExpiry,
        bytes32 nullifier,
        bytes32 nextCommitment,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = nullifier;
        publicInputs[1] = nextCommitment;
        publicInputs[2] = hashedAddress;
        publicInputs[3] = bytes32(uint256(passportExpiry));
        return i_primaryVerifier.verify(proof, publicInputs);
    }
}
