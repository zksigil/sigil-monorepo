// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerificationRegistry} from "./interfaces/IVerificationRegistry.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";
import {ICSCAMerkleTree} from "./interfaces/ICSCAMerkleTree.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title VerificationRegistry
/// @notice Two-tier ZK passport identity registry for Sigil.
///
/// @dev Architecture:
///      - Core logic is immutable. All tunables live in ProtocolConfig (swappable).
///      - ZK verifier is swappable (stub → real Noir verifier after circuit is ready).
///      - Governor starts as a multisig; transfer to DAO via transferGovernance().
///      - If core logic must change, set a successor and isVerified() delegates to it.
///
///      Privacy invariants enforced here (not in circuit):
///        - hashedAddress == keccak256(msg.sender) checked on every write
///        - No nullifier emitted in any event
///        - No address ↔ nullifier mapping queryable externally
///        - Switching primary address requires unregister + cooldown before
///          re-registering with the same (deterministic) nullifier from a new address.
///          All addresses ever registered as primary under the same passport are
///          linkable on-chain via the shared nullifier — explicit v1 trade-off.
contract VerificationRegistry is IVerificationRegistry, ReentrancyGuard, Pausable {
    // =========================================================================
    // Errors
    // =========================================================================

    error VerificationRegistry__NotGovernor();
    error VerificationRegistry__ZeroAddress();
    error VerificationRegistry__AlreadyRegistered();
    error VerificationRegistry__NotRegistered();
    error VerificationRegistry__PassportExpired();
    error VerificationRegistry__RateLimitExceeded();
    error VerificationRegistry__InvalidProof();
    error VerificationRegistry__NullifierAlreadyUsed();
    error VerificationRegistry__PrimaryInCooldown();
    error VerificationRegistry__NotAuthorized();

    // =========================================================================
    // Structs
    // =========================================================================

    /// @dev Tracks expiry and registration time for a single registered address (base or primary tier).
    ///      expiresAt is capped at passportExpiry via _cappedExpiry() so passportExpiry need not be stored.
    ///      registeredAt is set on registerPrimary and NOT updated on renewPrimary —
    ///      it reflects how long this passport has been committed to this address, which is the value
    ///      protocols care about when enforcing a minimum registration age.
    struct Registration {
        uint48 expiresAt;    // min(block.timestamp + TTL, passportExpiry)
        uint48 registeredAt; // block.timestamp at registration (not updated on renew)
    }

    // =========================================================================
    // Governance
    // =========================================================================

    address public s_governor;
    IProtocolConfig public s_config;
    IProofVerifier public s_verifier;
    ICSCAMerkleTree public s_cscaMerkleTree;
    address public s_successor;

    // =========================================================================
    // Base Tier State
    // =========================================================================

    /// @dev keccak256(abi.encodePacked(wallet)) => active registration.
    mapping(bytes32 => Registration) private s_baseRegistrations;

    /// @dev epochNullifier => number of base registrations today from this passport.
    ///      epochNullifier = hash(s, "epoch", floor(block.timestamp / 1 days))
    mapping(bytes32 => uint8) private s_epochCounts;

    // =========================================================================
    // Primary Tier State
    // =========================================================================

    /// @dev nullifier => keccak256(abi.encodePacked(registeredWallet)) of the active primary holder.
    ///      bytes32(0) means no active slot. The nullifier is deterministic per passport, so
    ///      re-registering the same passport to a different address reuses this same key.
    mapping(bytes32 => bytes32) public s_primarySlots;

    /// @dev keccak256(abi.encodePacked(wallet)) => nullifier of the active primary slot.
    ///      Reverse of s_primarySlots so the registered wallet can recover its nullifier
    ///      without local state. Cleared on unregister.
    mapping(bytes32 => bytes32) public s_primaryNullifierByWallet;

    /// @dev keccak256(abi.encodePacked(wallet)) => active primary registration.
    mapping(bytes32 => Registration) private s_primaryRegistrations;

    /// @dev nullifier => timestamp after which re-registration with this nullifier is allowed.
    mapping(bytes32 => uint256) private s_primaryUnregisteredAt;

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address governor_, IProtocolConfig config_, IProofVerifier verifier_, address cscaMerkleTree_) {
        if (governor_ == address(0)) revert VerificationRegistry__ZeroAddress();
        if (address(config_) == address(0)) revert VerificationRegistry__ZeroAddress();
        if (address(verifier_) == address(0)) revert VerificationRegistry__ZeroAddress();
        if (cscaMerkleTree_ == address(0)) revert VerificationRegistry__ZeroAddress();

        s_governor = governor_;
        s_config = config_;
        s_verifier = verifier_;
        s_cscaMerkleTree = ICSCAMerkleTree(cscaMerkleTree_);
    }

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyGovernor() {
        if (msg.sender != s_governor) revert VerificationRegistry__NotGovernor();
        _;
    }

    // =========================================================================
    // Base Tier — Registration
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function registerBase(
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();

        if (s_baseRegistrations[hashedAddress].expiresAt > block.timestamp) revert VerificationRegistry__AlreadyRegistered();

        uint8 count = s_epochCounts[epochNullifier];
        if (count >= s_config.maxDailyRegistrations()) revert VerificationRegistry__RateLimitExceeded();

        if (!s_verifier.verifyBaseProof(hashedAddress, epochNullifier, s_cscaMerkleTree.getRoot(), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_baseRegistrations[hashedAddress] = Registration({expiresAt: expiresAt, registeredAt: uint48(block.timestamp)});
        s_epochCounts[epochNullifier] = count + 1;

        emit WalletVerified(msg.sender);
    }

    /// @inheritdoc IVerificationRegistry
    function unregisterBase() external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));
        if (s_baseRegistrations[hashedAddress].expiresAt == 0) revert VerificationRegistry__NotRegistered();

        delete s_baseRegistrations[hashedAddress];
        // No event — privacy requirement
    }

    /// @inheritdoc IVerificationRegistry
    function renewBase(
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks — must have a registration (even if expired) to renew
        if (s_baseRegistrations[hashedAddress].expiresAt == 0) revert VerificationRegistry__NotRegistered();
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();

        // epochNullifier is zero for renewals — rate limiting only applies to new registrations
        if (!s_verifier.verifyBaseProof(hashedAddress, bytes32(0), s_cscaMerkleTree.getRoot(), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects — preserve original registeredAt on renewal
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_baseRegistrations[hashedAddress].expiresAt = expiresAt;
    }

    // =========================================================================
    // Primary Tier — Registration
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function registerPrimary(
        bytes32 nullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();
        if (s_primarySlots[nullifier] != bytes32(0)) revert VerificationRegistry__NullifierAlreadyUsed();
        if (block.timestamp < s_primaryUnregisteredAt[nullifier]) revert VerificationRegistry__PrimaryInCooldown();

        if (s_primaryRegistrations[hashedAddress].expiresAt > block.timestamp) revert VerificationRegistry__AlreadyRegistered();

        if (!s_verifier.verifyPrimaryProof(hashedAddress, nullifier, s_cscaMerkleTree.getRoot(), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_primarySlots[nullifier] = hashedAddress;
        s_primaryNullifierByWallet[hashedAddress] = nullifier;
        s_primaryRegistrations[hashedAddress] = Registration({expiresAt: expiresAt, registeredAt: uint48(block.timestamp)});

        emit WalletVerified(msg.sender);
    }

    /// @inheritdoc IVerificationRegistry
    function renewPrimary(
        bytes32 nullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();

        bytes32 slotHolder = s_primarySlots[nullifier];
        if (slotHolder == bytes32(0)) revert VerificationRegistry__NotRegistered();
        if (slotHolder != hashedAddress) revert VerificationRegistry__NotAuthorized();

        if (!s_verifier.verifyPrimaryProof(hashedAddress, nullifier, s_cscaMerkleTree.getRoot(), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects — extend TTL only; registeredAt is preserved to reflect true registration age
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_primaryRegistrations[hashedAddress].expiresAt = expiresAt;
    }

    /// @inheritdoc IVerificationRegistry
    function unregisterPrimary() external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks — msg.sender must own a primary slot
        bytes32 nullifier = s_primaryNullifierByWallet[hashedAddress];
        if (nullifier == bytes32(0)) revert VerificationRegistry__NotRegistered();

        // Effects
        delete s_primarySlots[nullifier];
        delete s_primaryNullifierByWallet[hashedAddress];
        delete s_primaryRegistrations[hashedAddress];
        s_primaryUnregisteredAt[nullifier] = block.timestamp + s_config.cooldownPeriod();

        // No event — privacy requirement
    }

    // =========================================================================
    // Protocol Integration
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function isVerified(address wallet) external view override returns (bool) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).isVerified(wallet);
        }
        return s_baseRegistrations[keccak256(abi.encodePacked(wallet))].expiresAt > block.timestamp;
    }

    /// @inheritdoc IVerificationRegistry
    function isPrimaryVerified(address wallet) external view override returns (bool) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).isPrimaryVerified(wallet);
        }
        return s_primaryRegistrations[keccak256(abi.encodePacked(wallet))].expiresAt > block.timestamp;
    }

    /// @inheritdoc IVerificationRegistry
    function getPrimaryRegisteredAt(address wallet) external view override returns (uint48) {
        return s_primaryRegistrations[keccak256(abi.encodePacked(wallet))].registeredAt;
    }

    /// @inheritdoc IVerificationRegistry
    function getBaseExpiry(address wallet) external view override returns (uint48) {
        return s_baseRegistrations[keccak256(abi.encodePacked(wallet))].expiresAt;
    }

    /// @inheritdoc IVerificationRegistry
    function getPrimaryExpiry(address wallet) external view override returns (uint48) {
        return s_primaryRegistrations[keccak256(abi.encodePacked(wallet))].expiresAt;
    }

    /// @inheritdoc IVerificationRegistry
    function wasNullifierUsed(bytes32 nullifier) external view override returns (bool) {
        return s_primarySlots[nullifier] != bytes32(0)
            || s_primaryUnregisteredAt[nullifier] != 0;
    }

    // =========================================================================
    // Governance
    // =========================================================================

    function transferGovernance(address newGovernor) external onlyGovernor {
        if (newGovernor == address(0)) revert VerificationRegistry__ZeroAddress();
        emit GovernanceTransferred(s_governor, newGovernor);
        s_governor = newGovernor;
    }

    function setConfig(IProtocolConfig newConfig) external onlyGovernor {
        if (address(newConfig) == address(0)) revert VerificationRegistry__ZeroAddress();
        emit ConfigUpdated(address(s_config), address(newConfig));
        s_config = newConfig;
    }

    function setVerifier(IProofVerifier newVerifier) external onlyGovernor {
        if (address(newVerifier) == address(0)) revert VerificationRegistry__ZeroAddress();
        emit VerifierUpdated(address(s_verifier), address(newVerifier));
        s_verifier = newVerifier;
    }

    function setCSCAMerkleTree(ICSCAMerkleTree newTree) external onlyGovernor {
        if (address(newTree) == address(0)) revert VerificationRegistry__ZeroAddress();
        emit CSCAMerkleTreeUpdated(address(s_cscaMerkleTree), address(newTree));
        s_cscaMerkleTree = newTree;
    }

    function setSuccessor(address newSuccessor) external onlyGovernor {
        if (newSuccessor == address(0)) revert VerificationRegistry__ZeroAddress();
        emit SuccessorSet(newSuccessor);
        s_successor = newSuccessor;
    }

    function pause() external onlyGovernor {
        _pause();
    }

    function unpause() external onlyGovernor {
        _unpause();
    }

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    /// @dev Returns block.timestamp + registrationTTL, capped at the quarter-rounded passport expiry.
    ///      Rounding down to the nearest 90-day boundary reduces calldata/state precision from
    ///      ~365 distinguishable values/year to 4, making passport expiry dates far less linkable
    ///      across different registered addresses from the same passport.
    uint48 private constant QUARTER = 90 days;

    function _cappedExpiry(uint48 passportExpiry) private view returns (uint48) {
        // Round up to next quarter boundary. Guard against overflow when passportExpiry
        // is near type(uint48).max by saturating: if adding QUARTER-1 would overflow, the
        // expiry is so far in the future that we can use passportExpiry as-is.
        uint48 roundedExpiry = passportExpiry <= type(uint48).max - (QUARTER - 1)
            ? ((passportExpiry + QUARTER - 1) / QUARTER) * QUARTER
            : passportExpiry;
        uint48 ttlExpiry = uint48(block.timestamp) + uint48(s_config.registrationTTL());
        return ttlExpiry < roundedExpiry ? ttlExpiry : roundedExpiry;
    }
}
