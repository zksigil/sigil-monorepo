// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVerificationRegistry} from "./interfaces/IVerificationRegistry.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Poseidon2Lib} from "poseidon2-evm/Poseidon2Lib.sol";
import {Field} from "poseidon2-evm/Field.sol";

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
///        - s_nextCommitmentToNullifier allows changePrimary without revealing old nullifier
///          in calldata (old nullifier is derived server-side from the reverse mapping)
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
    error VerificationRegistry__InvalidNextNullifier();
    error VerificationRegistry__PrimaryInCooldown();
    error VerificationRegistry__NotAuthorized();

    // =========================================================================
    // Structs
    // =========================================================================

    /// @dev Tracks expiry for a single registered address (base or primary tier).
    struct Registration {
        uint48 expiresAt;      // block.timestamp + TTL, capped at passportExpiry
        uint48 passportExpiry; // from ZK proof public input
    }

    /// @dev Stores the active primary slot for a given nullifier.
    ///      The nullifier itself is the mapping key — not stored inside the struct.
    struct PrimarySlot {
        bytes32 hashedAddress;  // keccak256(abi.encodePacked(registeredWallet))
        bytes32 nextCommitment; // hash(hash(s, nonce+1)) — used to verify changePrimary
    }

    // =========================================================================
    // Governance
    // =========================================================================

    address public s_governor;
    IProtocolConfig public s_config;
    IProofVerifier public s_verifier;
    address public s_oracleUpdater;
    address public s_successor;

    // =========================================================================
    // DSC Oracle
    // =========================================================================

    /// @notice Merkle root of valid Document Signing Certificates.
    ///         Updated by s_oracleUpdater. Used by future circuit versions to
    ///         prove the passport was signed by a non-revoked DSC.
    bytes32 public s_dscMerkleRoot;

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

    /// @dev nullifier => active primary slot. Public so the app can scan for recovery.
    mapping(bytes32 => PrimarySlot) public s_primarySlots;

    /// @dev nextCommitment => nullifier that stored it.
    ///      Enables changePrimary to locate the old slot without the old nullifier
    ///      appearing in calldata (preserving unlinkability between old and new nullifiers).
    mapping(bytes32 => bytes32) private s_nextCommitmentToNullifier;

    /// @dev keccak256(abi.encodePacked(wallet)) => active primary registration.
    mapping(bytes32 => Registration) private s_primaryRegistrations;

    /// @dev nullifier => timestamp after which re-registration with this nullifier is allowed.
    mapping(bytes32 => uint256) private s_primaryUnregisteredAt;

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address governor_, IProtocolConfig config_, IProofVerifier verifier_) {
        if (governor_ == address(0)) revert VerificationRegistry__ZeroAddress();
        if (address(config_) == address(0)) revert VerificationRegistry__ZeroAddress();
        if (address(verifier_) == address(0)) revert VerificationRegistry__ZeroAddress();

        s_governor = governor_;
        s_config = config_;
        s_verifier = verifier_;
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

        Registration memory existing = s_baseRegistrations[hashedAddress];
        bool active = existing.expiresAt > block.timestamp && existing.passportExpiry > block.timestamp;
        if (active) revert VerificationRegistry__AlreadyRegistered();

        uint8 count = s_epochCounts[epochNullifier];
        if (count >= s_config.maxDailyRegistrations()) revert VerificationRegistry__RateLimitExceeded();

        if (!s_verifier.verifyBaseProof(hashedAddress, passportExpiry, epochNullifier, proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_baseRegistrations[hashedAddress] = Registration({expiresAt: expiresAt, passportExpiry: passportExpiry});
        s_epochCounts[epochNullifier] = count + 1;

        emit WalletVerified(msg.sender);
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
        if (!s_verifier.verifyBaseProof(hashedAddress, passportExpiry, bytes32(0), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_baseRegistrations[hashedAddress] = Registration({expiresAt: expiresAt, passportExpiry: passportExpiry});
    }

    // =========================================================================
    // Primary Tier — Registration
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function registerPrimary(
        bytes32 nullifier,
        bytes32 nextCommitment,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();
        if (s_primarySlots[nullifier].hashedAddress != bytes32(0)) revert VerificationRegistry__NullifierAlreadyUsed();
        if (block.timestamp < s_primaryUnregisteredAt[nullifier]) revert VerificationRegistry__PrimaryInCooldown();

        Registration memory existing = s_primaryRegistrations[hashedAddress];
        bool active = existing.expiresAt > block.timestamp && existing.passportExpiry > block.timestamp;
        if (active) revert VerificationRegistry__AlreadyRegistered();

        if (!s_verifier.verifyPrimaryProof(hashedAddress, passportExpiry, nullifier, nextCommitment, proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_primarySlots[nullifier] = PrimarySlot({hashedAddress: hashedAddress, nextCommitment: nextCommitment});
        s_nextCommitmentToNullifier[nextCommitment] = nullifier;
        s_primaryRegistrations[hashedAddress] = Registration({expiresAt: expiresAt, passportExpiry: passportExpiry});

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

        PrimarySlot memory slot = s_primarySlots[nullifier];
        if (slot.hashedAddress == bytes32(0)) revert VerificationRegistry__NotRegistered();
        if (slot.hashedAddress != hashedAddress) revert VerificationRegistry__NotAuthorized();

        if (!s_verifier.verifyPrimaryProof(hashedAddress, passportExpiry, nullifier, slot.nextCommitment, proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects — extend TTL, update passport expiry (e.g. after passport renewal)
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_primaryRegistrations[hashedAddress] = Registration({expiresAt: expiresAt, passportExpiry: passportExpiry});
    }

    /// @inheritdoc IVerificationRegistry
    function changePrimary(
        bytes32 revealedNextNullifier,
        bytes32 newNextCommitment,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 newHashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();

        // Locate old slot: nextCommitment stored by old slot == Poseidon2(revealedNextNullifier)
        // Must match the circuit: next_commitment = Poseidon2::hash([next_nullifier], 1)
        bytes32 expectedCommitment =
            bytes32(Field.Type.unwrap(Poseidon2Lib.hash_1(Field.Type.wrap(uint256(revealedNextNullifier)))));
        bytes32 oldNullifier = s_nextCommitmentToNullifier[expectedCommitment];
        if (oldNullifier == bytes32(0)) revert VerificationRegistry__InvalidNextNullifier();

        PrimarySlot memory oldSlot = s_primarySlots[oldNullifier];
        if (oldSlot.hashedAddress == bytes32(0)) revert VerificationRegistry__InvalidNextNullifier();

        // Verify proof: proves caller knows s, hash(s,n+1) == revealedNextNullifier, new address
        if (
            !s_verifier.verifyPrimaryProof(
                newHashedAddress, passportExpiry, revealedNextNullifier, newNextCommitment, proof
            )
        ) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects — delete old slot and its commitment pointer
        delete s_primarySlots[oldNullifier];
        delete s_nextCommitmentToNullifier[expectedCommitment];
        delete s_primaryRegistrations[oldSlot.hashedAddress];

        // Create new slot with revealedNextNullifier as the live nullifier
        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_primarySlots[revealedNextNullifier] =
            PrimarySlot({hashedAddress: newHashedAddress, nextCommitment: newNextCommitment});
        s_nextCommitmentToNullifier[newNextCommitment] = revealedNextNullifier;
        s_primaryRegistrations[newHashedAddress] =
            Registration({expiresAt: expiresAt, passportExpiry: passportExpiry});

        emit WalletVerified(msg.sender);
    }

    /// @inheritdoc IVerificationRegistry
    function unregisterPrimary(bytes32 nullifier) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks — only the registered address can unregister
        PrimarySlot memory slot = s_primarySlots[nullifier];
        if (slot.hashedAddress == bytes32(0)) revert VerificationRegistry__NotRegistered();
        if (slot.hashedAddress != hashedAddress) revert VerificationRegistry__NotAuthorized();

        // Effects
        delete s_primarySlots[nullifier];
        delete s_nextCommitmentToNullifier[slot.nextCommitment];
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
        Registration memory reg = s_baseRegistrations[keccak256(abi.encodePacked(wallet))];
        return reg.expiresAt > block.timestamp && reg.passportExpiry > block.timestamp;
    }

    /// @inheritdoc IVerificationRegistry
    function isPrimaryVerified(address wallet) external view override returns (bool) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).isPrimaryVerified(wallet);
        }
        Registration memory reg = s_primaryRegistrations[keccak256(abi.encodePacked(wallet))];
        return reg.expiresAt > block.timestamp && reg.passportExpiry > block.timestamp;
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

    function setOracleUpdater(address newUpdater) external onlyGovernor {
        emit OracleUpdaterSet(s_oracleUpdater, newUpdater);
        s_oracleUpdater = newUpdater;
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
    // Oracle
    // =========================================================================

    function updateDSCRoot(bytes32 newRoot) external {
        if (msg.sender != s_oracleUpdater) revert VerificationRegistry__NotAuthorized();
        emit DSCRootUpdated(newRoot);
        s_dscMerkleRoot = newRoot;
    }

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    /// @dev Returns block.timestamp + registrationTTL, capped at passportExpiry.
    function _cappedExpiry(uint48 passportExpiry) private view returns (uint48) {
        uint48 ttlExpiry = uint48(block.timestamp) + uint48(s_config.registrationTTL());
        return ttlExpiry < passportExpiry ? ttlExpiry : passportExpiry;
    }
}
