// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IVerificationRegistry
/// @notice Two-tier on-chain identity registry backed by ZK passport proofs.
///
/// @dev Two tiers, both queryable with a single mapping lookup:
///
///      Base tier  — proof of personhood, fully unlinkable.
///                   Multiple addresses per passport allowed. No passport-derived
///                   data stored on-chain. Rate-limited to maxDailyRegistrations/day.
///
///      Primary tier — sybil resistance (one address per passport, globally).
///                     The primary nullifier is deterministic per passport, so the
///                     same value is reused across registrations of the same passport.
///                     Switching to a different primary address requires unregister +
///                     cooldown before re-registering with the same nullifier.
///
///      All registrations expire at min(registrationTTL, passportExpiry). Users must
///      re-tap their passport periodically to renew. isVerified / isPrimaryVerified
///      return false lazily for expired registrations (no write required).
///
///      Privacy invariants:
///        - No nullifiers in any event
///        - No address ↔ nullifier mapping stored or queryable
///        - All addresses ever registered as primary under the same passport are
///          linkable on-chain (they share a stable nullifier). This is an explicit
///          v1 trade-off: the base tier remains the unlinkable option.
interface IVerificationRegistry {
    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted on successful base or primary registration / renewal.
    /// @dev NO nullifier — critical privacy requirement.
    event WalletVerified(address indexed wallet);

    /// @notice Emitted when the governor address changes.
    event GovernanceTransferred(address indexed oldGovernor, address indexed newGovernor);

    /// @notice Emitted when the ProtocolConfig contract is updated.
    event ConfigUpdated(address indexed oldConfig, address indexed newConfig);

    /// @notice Emitted when the ProofVerifier contract is updated.
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    /// @notice Emitted when the CSCA Merkle Tree contract is updated.
    event CSCAMerkleTreeUpdated(address indexed oldTree, address indexed newTree);

    /// @notice Emitted when a successor registry is designated.
    event SuccessorSet(address indexed successor);

    // =========================================================================
    // Base Tier
    // =========================================================================

    /// @notice Register the caller's wallet as a verified human (base tier).
    /// @param epochNullifier Rate-limiting nullifier derived from passport + current day.
    /// @param passportExpiry Passport expiry timestamp, submitted separately to the contract.
    /// @param proof ZK proof bytes.
    function registerBase(bytes32 epochNullifier, uint48 passportExpiry, bytes calldata proof) external;

    /// @notice Renew an existing base-tier registration, extending its TTL.
    /// @dev Re-tapping the passport resets expiresAt to now + registrationTTL.
    function renewBase(uint48 passportExpiry, bytes calldata proof) external;

    /// @notice Remove the caller's base-tier registration.
    /// @dev No event emitted — privacy requirement. The epochNullifier count for the day
    ///      is not decremented, so unregistering does not free up a daily registration slot.
    function unregisterBase() external;

    // =========================================================================
    // Primary Tier
    // =========================================================================

    /// @notice Register the caller's wallet as the unique primary address for a passport.
    /// @param nullifier      Stable primary nullifier derived from the passport secret.
    ///                       The same value is used for every registration of this passport;
    ///                       cooldown is enforced per-nullifier.
    /// @param passportExpiry Passport expiry timestamp.
    /// @param proof          ZK proof bytes.
    function registerPrimary(
        bytes32 nullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external;

    /// @notice Renew an existing primary-tier registration, extending its TTL.
    /// @param nullifier      The stable primary nullifier for the caller's passport.
    /// @param passportExpiry Updated passport expiry (e.g. after passport renewal).
    /// @param proof          ZK proof bytes.
    function renewPrimary(bytes32 nullifier, uint48 passportExpiry, bytes calldata proof) external;

    /// @notice Remove the caller's primary registration and start the cooldown timer.
    /// @dev The contract looks up the caller's nullifier via s_primaryNullifierByWallet.
    ///      To switch primary to a different address, unregister, wait the cooldown,
    ///      then call registerPrimary again from the new address with the same nullifier.
    function unregisterPrimary() external;

    // =========================================================================
    // Protocol Integration (single-line lookups)
    // =========================================================================

    /// @notice Returns true if wallet has an active, non-expired base-tier registration.
    function isVerified(address wallet) external view returns (bool);

    /// @notice Returns true if wallet has an active, non-expired primary-tier registration.
    function isPrimaryVerified(address wallet) external view returns (bool);

    /// @notice Returns the base-tier registration expiry for wallet (0 if never registered).
    function getBaseExpiry(address wallet) external view returns (uint48);

    /// @notice Returns the primary-tier registration expiry for wallet (0 if never registered).
    function getPrimaryExpiry(address wallet) external view returns (uint48);

    /// @notice Returns the timestamp when wallet's current primary registration was created (0 if never registered).
    /// @dev Renewing does not reset this value — it reflects when this address was first (or last) registered/changed.
    ///      Protocols can use this to enforce a minimum registration age, e.g. require(age >= 30 days).
    function getPrimaryRegisteredAt(address wallet) external view returns (uint48);

    /// @notice Returns true if this primary nullifier has ever been used (currently registered OR previously unregistered).
    /// @dev Lets the app distinguish "first-time passport registration" from "returning passport"
    ///      to drive UI copy. Returning a boolean instead of the cooldown timestamp avoids leaking
    ///      when the unregister happened.
    function wasNullifierUsed(bytes32 nullifier) external view returns (bool);
}
