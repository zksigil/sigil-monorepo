// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerificationRegistry} from "./interfaces/IVerificationRegistry.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";
import {ICSCAMerkleTree} from "./interfaces/ICSCAMerkleTree.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title VerificationRegistry
/// @notice Single-tier ZK passport identity registry for Sigil.
///
/// @dev One stable nullifier per passport. Multiple wallets can register under the same
///      nullifier — they are publicly linkable on-chain via the shared `nullifierByWallet`
///      mapping and the `walletsByNullifier` array.
///
///      Architecture:
///        - Core logic is immutable. Tunables live in ProtocolConfig (swappable).
///        - ZK verifier is swappable for circuit upgrades.
///        - Governor starts as a multisig; transfer to DAO via `transferGovernance()`.
///        - If core logic must change, set a successor and read functions delegate to it.
///
///      Privacy invariants enforced here (not in circuit):
///        - hashedAddress == keccak256(msg.sender) checked on every write.
///        - No nullifier in any event.
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
    error VerificationRegistry__NullifierMismatch();

    // =========================================================================
    // Structs
    // =========================================================================

    /// @dev Tracks expiry and registration time for a single registered wallet.
    ///      `expiresAt = min(now + registrationTTL, ceil(passportExpiry / 90 days) * 90 days)`
    ///      `registeredAt` is set on first `register` and preserved across `renew`.
    struct Registration {
        uint48 expiresAt;
        uint48 registeredAt;
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
    // Registration State
    // =========================================================================

    /// @dev keccak256(abi.encodePacked(wallet)) => active registration.
    mapping(bytes32 => Registration) private s_registrations;

    /// @dev keccak256(abi.encodePacked(wallet)) => stable per-passport nullifier.
    ///      Public — this is the sybil identifier protocols read via `nullifierOf`.
    mapping(bytes32 => bytes32) public s_nullifierByWallet;

    /// @dev nullifier => list of wallets registered under it. Mutated on register/unregister
    ///      via swap-and-pop. Includes wallets whose registrations have expired but not been
    ///      unregistered (filter by `isVerified` for active-only).
    mapping(bytes32 => address[]) private s_walletsByNullifier;

    /// @dev nullifier => wallet => 1-based index into `s_walletsByNullifier[nullifier]`.
    ///      Zero means the wallet is not in the array. Used to support O(1) swap-and-pop.
    mapping(bytes32 => mapping(address => uint256)) private s_walletIndex;

    /// @dev epochNullifier => number of new registrations this epoch.
    ///      `epochNullifier = hash(s, "epoch", floor(block.timestamp / 1 days))`.
    mapping(bytes32 => uint8) private s_epochCounts;

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
    // Mutations
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function register(
        bytes32 nullifier,
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();
        if (s_registrations[hashedAddress].expiresAt > block.timestamp) revert VerificationRegistry__AlreadyRegistered();

        uint8 count = s_epochCounts[epochNullifier];
        if (count >= s_config.maxDailyRegistrations()) revert VerificationRegistry__RateLimitExceeded();

        if (!s_verifier.verifyProof(hashedAddress, nullifier, epochNullifier, s_cscaMerkleTree.getRoot(), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects
        // If this wallet was previously registered under a different nullifier (e.g. an
        // expired registration with an old passport that has since been replaced), evict
        // it from the old nullifier's wallet array so the array stays accurate.
        bytes32 prevNullifier = s_nullifierByWallet[hashedAddress];
        bool isReregistration = (prevNullifier == nullifier);
        if (prevNullifier != bytes32(0) && prevNullifier != nullifier) {
            _removeWalletFromArray(prevNullifier, msg.sender);
        }

        // Append to nullifier's wallet array (skip if this is a re-registration of an
        // expired entry under the SAME nullifier — already in the array).
        if (!isReregistration || s_walletIndex[nullifier][msg.sender] == 0) {
            s_walletsByNullifier[nullifier].push(msg.sender);
            s_walletIndex[nullifier][msg.sender] = s_walletsByNullifier[nullifier].length;
        }

        uint48 expiresAt = _cappedExpiry(passportExpiry);
        s_registrations[hashedAddress] = Registration({expiresAt: expiresAt, registeredAt: uint48(block.timestamp)});
        s_nullifierByWallet[hashedAddress] = nullifier;
        s_epochCounts[epochNullifier] = count + 1;

        emit WalletVerified(msg.sender);
    }

    /// @inheritdoc IVerificationRegistry
    function renew(
        bytes32 nullifier,
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks — must already be registered, and renewal must use the same nullifier.
        // To replace the passport (different nullifier), unregister first then register fresh.
        if (s_registrations[hashedAddress].expiresAt == 0) revert VerificationRegistry__NotRegistered();
        if (s_nullifierByWallet[hashedAddress] != nullifier) revert VerificationRegistry__NullifierMismatch();
        if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired();

        // The real epochNullifier is passed through to the verifier (the circuit always
        // constrains it). Rate limiting is NOT applied on renewals — `s_epochCounts` stays put.
        if (!s_verifier.verifyProof(hashedAddress, nullifier, epochNullifier, s_cscaMerkleTree.getRoot(), proof)) {
            revert VerificationRegistry__InvalidProof();
        }

        // Effects — preserve registeredAt; only extend expiresAt.
        s_registrations[hashedAddress].expiresAt = _cappedExpiry(passportExpiry);
    }

    /// @inheritdoc IVerificationRegistry
    function unregister() external override whenNotPaused nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));
        if (s_registrations[hashedAddress].expiresAt == 0) revert VerificationRegistry__NotRegistered();

        bytes32 nullifier = s_nullifierByWallet[hashedAddress];
        _removeWalletFromArray(nullifier, msg.sender);

        delete s_registrations[hashedAddress];
        delete s_nullifierByWallet[hashedAddress];
        // No event — privacy requirement.
    }

    // =========================================================================
    // Protocol Integration
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function isVerified(address wallet) external view override returns (bool) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).isVerified(wallet);
        }
        return s_registrations[keccak256(abi.encodePacked(wallet))].expiresAt > block.timestamp;
    }

    /// @inheritdoc IVerificationRegistry
    function nullifierOf(address wallet) external view override returns (bytes32) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).nullifierOf(wallet);
        }
        return s_nullifierByWallet[keccak256(abi.encodePacked(wallet))];
    }

    /// @inheritdoc IVerificationRegistry
    function getExpiry(address wallet) external view override returns (uint48) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).getExpiry(wallet);
        }
        return s_registrations[keccak256(abi.encodePacked(wallet))].expiresAt;
    }

    /// @inheritdoc IVerificationRegistry
    function getRegisteredAt(address wallet) external view override returns (uint48) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).getRegisteredAt(wallet);
        }
        return s_registrations[keccak256(abi.encodePacked(wallet))].registeredAt;
    }

    /// @inheritdoc IVerificationRegistry
    function getWallets(bytes32 nullifier) external view override returns (address[] memory) {
        if (s_successor != address(0)) {
            return IVerificationRegistry(s_successor).getWallets(nullifier);
        }
        return s_walletsByNullifier[nullifier];
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

    /// @dev Removes a wallet from `s_walletsByNullifier[nullifier]` via swap-and-pop.
    ///      No-op if the wallet is not in the array.
    function _removeWalletFromArray(bytes32 nullifier, address wallet) private {
        uint256 idx1 = s_walletIndex[nullifier][wallet];
        if (idx1 == 0) return;

        address[] storage arr = s_walletsByNullifier[nullifier];
        uint256 idx = idx1 - 1;
        uint256 lastIdx = arr.length - 1;
        if (idx != lastIdx) {
            address moved = arr[lastIdx];
            arr[idx] = moved;
            s_walletIndex[nullifier][moved] = idx1; // moved now holds the 1-based index of the removed slot
        }
        arr.pop();
        delete s_walletIndex[nullifier][wallet];
    }

    /// @dev Computes effective `expiresAt`:
    ///        `min(now + registrationTTL, ceil(passportExpiry / 90 days) * 90 days)`
    ///
    ///      The passport-expiry component is rounded UP to the next 90-day boundary anchored
    ///      to the Unix epoch (NOT calendar quarters). This collapses ~365 distinguishable
    ///      expiry values per year into 4. Side effect: a registration can stay valid up to
    ///      ~89 days past actual passport expiry. `isVerified` does not re-check passport
    ///      expiry on read, so this grace window only affects existing registrations whose
    ///      passport happens to lapse mid-quarter; all entrypoints reject expired passports
    ///      up front.
    uint48 private constant QUARTER = 90 days;

    function _cappedExpiry(uint48 passportExpiry) private view returns (uint48) {
        uint48 roundedExpiry = passportExpiry <= type(uint48).max - (QUARTER - 1)
            ? ((passportExpiry + QUARTER - 1) / QUARTER) * QUARTER
            : passportExpiry;
        uint48 ttlExpiry = uint48(block.timestamp) + uint48(s_config.registrationTTL());
        return ttlExpiry < roundedExpiry ? ttlExpiry : roundedExpiry;
    }
}
