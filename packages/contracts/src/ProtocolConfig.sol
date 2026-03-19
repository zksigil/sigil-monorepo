// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";

/// @title ProtocolConfig
/// @notice Stores tunable protocol parameters for VerificationRegistry.
/// @dev All setters enforce hard bounds — even the governor cannot set values outside them.
///      To update parameters: governor calls the setter directly, or (once a DAO is set as
///      governor) a governance proposal calls it via the TimelockController.
///
///      Hard bounds are constants, not configurable, to ensure a governance attack cannot
///      set security-critical values to extremes (e.g. TTL = 100 years).
contract ProtocolConfig is IProtocolConfig {
    // =========================================================================
    // Errors
    // =========================================================================

    error ProtocolConfig__NotGovernor();
    error ProtocolConfig__OutOfBounds(string param, uint256 min, uint256 max);

    // =========================================================================
    // Hard Bounds (constants — not governable)
    // =========================================================================

    uint256 public constant MIN_TTL = 30 days;
    uint256 public constant MAX_TTL = 365 days;

    uint256 public constant MIN_COOLDOWN = 1 days;
    uint256 public constant MAX_COOLDOWN = 90 days;

    uint8 public constant MIN_DAILY_REGISTRATIONS = 1;
    uint8 public constant MAX_DAILY_REGISTRATIONS = 50;

    // =========================================================================
    // State
    // =========================================================================

    address public s_governor;

    uint256 private s_registrationTTL;
    uint256 private s_cooldownPeriod;
    uint8 private s_maxDailyRegistrations;

    // =========================================================================
    // Events
    // =========================================================================

    event GovernanceTransferred(address indexed oldGovernor, address indexed newGovernor);
    event RegistrationTTLUpdated(uint256 oldValue, uint256 newValue);
    event CooldownPeriodUpdated(uint256 oldValue, uint256 newValue);
    event MaxDailyRegistrationsUpdated(uint8 oldValue, uint8 newValue);

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param governor_ Initial governor address (typically a TimelockController).
    constructor(address governor_) {
        require(governor_ != address(0), "ProtocolConfig: zero address");
        s_governor = governor_;

        // Defaults
        s_registrationTTL = 180 days;
        s_cooldownPeriod = 7 days;
        s_maxDailyRegistrations = 10;
    }

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyGovernor() {
        if (msg.sender != s_governor) revert ProtocolConfig__NotGovernor();
        _;
    }

    // =========================================================================
    // IProtocolConfig
    // =========================================================================

    /// @inheritdoc IProtocolConfig
    function registrationTTL() external view override returns (uint256) {
        return s_registrationTTL;
    }

    /// @inheritdoc IProtocolConfig
    function cooldownPeriod() external view override returns (uint256) {
        return s_cooldownPeriod;
    }

    /// @inheritdoc IProtocolConfig
    function maxDailyRegistrations() external view override returns (uint8) {
        return s_maxDailyRegistrations;
    }

    // =========================================================================
    // Governor-Only Setters
    // =========================================================================

    function setRegistrationTTL(uint256 newTTL) external onlyGovernor {
        if (newTTL < MIN_TTL || newTTL > MAX_TTL) {
            revert ProtocolConfig__OutOfBounds("registrationTTL", MIN_TTL, MAX_TTL);
        }
        emit RegistrationTTLUpdated(s_registrationTTL, newTTL);
        s_registrationTTL = newTTL;
    }

    function setCooldownPeriod(uint256 newCooldown) external onlyGovernor {
        if (newCooldown < MIN_COOLDOWN || newCooldown > MAX_COOLDOWN) {
            revert ProtocolConfig__OutOfBounds("cooldownPeriod", MIN_COOLDOWN, MAX_COOLDOWN);
        }
        emit CooldownPeriodUpdated(s_cooldownPeriod, newCooldown);
        s_cooldownPeriod = newCooldown;
    }

    function setMaxDailyRegistrations(uint8 newMax) external onlyGovernor {
        if (newMax < MIN_DAILY_REGISTRATIONS || newMax > MAX_DAILY_REGISTRATIONS) {
            revert ProtocolConfig__OutOfBounds(
                "maxDailyRegistrations",
                MIN_DAILY_REGISTRATIONS,
                MAX_DAILY_REGISTRATIONS
            );
        }
        emit MaxDailyRegistrationsUpdated(s_maxDailyRegistrations, newMax);
        s_maxDailyRegistrations = newMax;
    }

    function transferGovernance(address newGovernor) external onlyGovernor {
        require(newGovernor != address(0), "ProtocolConfig: zero address");
        emit GovernanceTransferred(s_governor, newGovernor);
        s_governor = newGovernor;
    }
}
