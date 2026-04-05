// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IProtocolConfig
/// @notice Tunable protocol parameters read by VerificationRegistry.
/// @dev Deployed as a separate contract so parameters can be updated (via governor)
///      without redeploying the registry. Hard bounds on all values are enforced
///      in the implementation, not here.
interface IProtocolConfig {
    /// @notice How long a registration remains valid after being created or renewed.
    ///         Users must re-tap their passport before this expires to stay registered.
    ///         Effective expiry = min(registrationTTL, passportExpiry - now).
    function registrationTTL() external view returns (uint256);

    /// @notice Cooldown after a primary registration is explicitly unregistered before
    ///         the same nullifier can be used to register again.
    function cooldownPeriod() external view returns (uint256);

    /// @notice Maximum number of base-tier registrations allowed per passport per day.
    ///         Enforced via a per-epoch nullifier count stored in the registry.
    function maxDailyRegistrations() external view returns (uint8);
}
