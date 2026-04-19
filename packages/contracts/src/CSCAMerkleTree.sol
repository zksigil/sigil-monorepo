// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title CSCAMerkleTree
/// @notice Stores the root of a Poseidon2 Merkle tree containing ICAO CSCA certificate hashes.
/// @dev The tree is built off-chain from the ICAO Public Key Directory Master List.
///      Only the root is stored on-chain to save gas. When ICAO releases a new Master List,
///      the owner updates the root. Existing verified wallets are unaffected — only new
///      registrations require a valid proof with the current root.
///
///      Tree parameters:
///      - Depth: 9 (512 leaves)
///      - Leaf hash: poseidon2Hash(modulus, exponent)
///      - Internal node: poseidon2Hash(left, right)
///      - Empty leaf: poseidon2Hash(0, 0)
contract CSCAMerkleTree is Ownable2Step {
    // =========================================================================
    // State
    // =========================================================================

    bytes32 private s_merkleRoot;
    uint256 private s_lastUpdatedAt;

    // =========================================================================
    // Events
    // =========================================================================

    event MerkleRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 timestamp);

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param initialRoot Merkle root computed from the ICAO CSCA certificate set.
    /// @param initialOwner Address that will be the initial owner.
    constructor(bytes32 initialRoot, address initialOwner) Ownable(initialOwner) {
        _setRoot(initialRoot);
    }

    // =========================================================================
    // Views
    // =========================================================================

    /// @notice Returns the current CSCA Merkle tree root.
    /// @return The Poseidon2 Merkle root of all CSCA certificates.
    function getRoot() external view returns (bytes32) {
        return s_merkleRoot;
    }

    /// @notice Returns the timestamp when the root was last updated.
    /// @return Unix timestamp of the last root update.
    function lastUpdatedAt() external view returns (uint256) {
        return s_lastUpdatedAt;
    }

    // =========================================================================
    // Owner-Only
    // =========================================================================

    /// @notice Updates the CSCA Merkle tree root (e.g., after ICAO releases a new Master List).
    /// @param newRoot New Poseidon2 Merkle root computed from the updated CSCA certificate set.
    /// @dev Accessible only by the owner. Existing verified wallets are unaffected.
    function setRoot(bytes32 newRoot) external onlyOwner {
        _setRoot(newRoot);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _setRoot(bytes32 newRoot) private {
        bytes32 oldRoot = s_merkleRoot;
        s_merkleRoot = newRoot;
        s_lastUpdatedAt = block.timestamp;
        emit MerkleRootUpdated(oldRoot, newRoot, block.timestamp);
    }
}
