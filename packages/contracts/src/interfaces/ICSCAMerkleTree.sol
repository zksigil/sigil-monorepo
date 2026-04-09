// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ICSCAMerkleTree
/// @notice Interface for the on-chain CSCA Merkle tree root registry.
/// @dev The Merkle tree contains ICAO CSCA certificate hashes. Only the root is stored
///      on-chain. Updated by the owner when ICAO releases a new Master List.
interface ICSCAMerkleTree {
    /// @notice Returns the current CSCA Merkle tree root.
    function getRoot() external view returns (bytes32);

    /// @notice Returns the timestamp when the root was last updated.
    function lastUpdatedAt() external view returns (uint256);

    /// @notice Updates the CSCA Merkle tree root (owner-only).
    function setRoot(bytes32 newRoot) external;
}
