// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISigilRegistry
/// @notice Single-tier on-chain identity registry backed by ZK passport proofs.
///
/// @dev Model:
///      - One stable nullifier per passport (`Poseidon2(passportSecret, 1)`).
///      - A user can sigilize multiple wallets — they all share the same nullifier on-chain
///        and are publicly linkable as belonging to the same passport.
///      - Protocols call `isVerified(wallet)` for proof of personhood.
///        Protocols call `nullifierOf(wallet)` to dedupe per-protocol (sybil resistance).
///
///      Trust model:
///      - The registry contract is immutable: no governor, no setters, no pause, no successor.
///      - Parameters (`registrationTTL`, `maxDailyRegistrations`) are immutables, set in
///        the constructor with hard bounds enforced at deploy time.
///      - The proof verifier and CSCA Merkle tree contract addresses are also immutables.
///      - The only ongoing privileged action in the system is rotating the CSCA Merkle root,
///        which lives on `CSCAMerkleTree` (Ownable2Step). It cannot affect existing
///        registrations, only which proofs new registrations will accept.
///
///      Privacy:
///      - All addresses sigilized under the same passport are publicly linkable via the
///        shared nullifier. Users opt-in per wallet — non-sigilized wallets stay anonymous.
///      - No name, DOB, nationality, or any other passport-derived data on-chain.
///
///      Expiry:
///      - All registrations expire at `min(now + registrationTTL,
///        ceil(passportExpiry / 90 days) * 90 days)`. The passport-expiry component is
///        rounded UP to the next 90-day boundary anchored to the Unix epoch (privacy:
///        collapses ~365 distinct expiry timestamps into 4). Re-tapping the passport
///        before `expiresAt` renews; `isVerified` returns false lazily for expired
///        registrations (no on-chain write needed).
///
///      Rate limiting:
///      - Max `maxDailyRegistrations` new wallets per passport per day, enforced via an
///        epoch nullifier (`Poseidon2(passport_secret, epoch_day)`). Renewals are exempt.
interface ISigilRegistry {
    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted on successful registration / renewal.
    /// @dev NO nullifier — that level of detail belongs in storage (publicly readable),
    ///      not in indexed event topics.
    event WalletVerified(address indexed wallet);

    // =========================================================================
    // Mutations
    // =========================================================================

    /// @notice Sigilize the caller's wallet — link it to the passport identified by `nullifier`.
    /// @param nullifier      Stable per-passport nullifier (Poseidon2(s, 1)). Multiple wallets
    ///                       may share this nullifier.
    /// @param epochNullifier Rate-limiting nullifier: Poseidon2(passport_secret, epoch_day).
    ///                       New registrations per epoch are capped at `maxDailyRegistrations`.
    /// @param passportExpiry Passport expiry timestamp.
    /// @param proof          ZK proof bytes.
    function register(
        bytes32 nullifier,
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external;

    /// @notice Renew the caller's existing registration — extends `expiresAt`.
    ///         Must be called from the same wallet with the same nullifier as the existing
    ///         registration; the proof binds the nullifier to the passport that owns it.
    /// @param nullifier      Stable per-passport nullifier — must match the wallet's existing one.
    /// @param epochNullifier Real epoch nullifier for the day the proof was generated. Required
    ///                       so the proof's public input matches the circuit's constraint, but
    ///                       NOT counted toward the daily rate limit on renewals.
    /// @param passportExpiry Updated passport expiry (e.g. after passport renewal).
    /// @param proof          ZK proof bytes.
    /// @dev Renewals are exempt from the daily rate limit. `registeredAt` is preserved.
    function renew(
        bytes32 nullifier,
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external;

    /// @notice Remove the caller's registration. No event emitted (privacy).
    /// @dev Also removes the caller from `walletsByNullifier`. The `nullifierByWallet`
    ///      mapping is cleared.
    function unregister() external;

    // =========================================================================
    // Protocol Integration (single-line lookups)
    // =========================================================================

    /// @notice Returns true if `wallet` has an active, non-expired registration.
    function isVerified(address wallet) external view returns (bool);

    /// @notice Returns the nullifier `wallet` is registered under, or `bytes32(0)`.
    /// @dev Returns the nullifier even after expiry; pair with `isVerified` for liveness.
    ///      This is the public sybil identifier — protocols can use it as a per-protocol
    ///      dedup key (`mapping(bytes32 => bool) seenInThisProtocol`).
    function nullifierOf(address wallet) external view returns (bytes32);

    /// @notice Returns the registration's `expiresAt` (0 if never registered).
    /// @dev Stored as `min(now + registrationTTL, ceil(passportExpiry / 90 days) * 90 days)`
    ///      at registration / renewal time. The 90-day rounding can place expiresAt up to
    ///      ~89 days past actual passport expiry.
    function getExpiry(address wallet) external view returns (uint48);

    /// @notice Returns the timestamp when this wallet was first registered with its current
    ///         nullifier (0 if never registered). Renewals do not reset this value.
    /// @dev Protocols can use this to enforce a minimum registration age.
    function getRegisteredAt(address wallet) external view returns (uint48);

    /// @notice Returns all wallets currently registered under `nullifier`.
    /// @dev Includes wallets whose registrations have expired but not been unregistered.
    ///      Filter by `isVerified` for active-only. Order is registration order, with
    ///      swap-and-pop on `unregister` (so the array is unordered after any unregister).
    function getWallets(bytes32 nullifier) external view returns (address[] memory);
}
