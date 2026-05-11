// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISigilRegistry} from "./interfaces/ISigilRegistry.sol";
import {CSCAMerkleTree} from "./CSCAMerkleTree.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Surface of the generated Noir UltraHonk verifier (SigilUltraHonkVerifier.sol).
///      Declared here rather than imported so we don't pin the registry to that exact contract —
///      any verifier with this signature (e.g. a test mock) is interchangeable at deploy time.
interface IUltraHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title SigilRegistry
/// @notice Single-tier ZK passport identity registry for Sigil. Immutable after deploy.
///
/// @dev One stable nullifier per passport. Multiple wallets can register under the same
///      nullifier — they are publicly linkable on-chain via the shared `nullifierByWallet`
///      mapping and the `walletsByNullifier` array.
///
///      No governor. No setters. No pause. No successor. Once deployed, the contract's
///      behavior is fixed — only the CSCA Merkle root (held in a separate contract,
///      Ownable2Step) can change, which affects only which proofs new registrations
///      will accept; existing registrations are unaffected.
///
///      Parameters (`i_registrationTTL`, `i_maxDailyRegistrations`) are immutables with
///      hard bounds enforced in the constructor.
///
///      Privacy invariants enforced here (not in circuit):
///        - hashedAddress == keccak256(msg.sender) checked on every write.
///        - No nullifier in any event.
contract SigilRegistry is ISigilRegistry, ReentrancyGuard {
    // =========================================================================
    // Errors
    // =========================================================================

    error SigilRegistry__ZeroAddress();
    error SigilRegistry__InvalidConfig();
    error SigilRegistry__AlreadyRegistered();
    error SigilRegistry__NotRegistered();
    error SigilRegistry__PassportExpired();
    error SigilRegistry__RateLimitExceeded();
    error SigilRegistry__InvalidProof();
    error SigilRegistry__NullifierMismatch();

    // =========================================================================
    // Constants — hard bounds for constructor parameters
    // =========================================================================

    /// @dev Min/max registration TTL. Bounds the privacy/UX trade-off: shorter TTL means
    ///      more frequent re-taps; longer TTL means staler proofs.
    uint256 private constant MIN_TTL = 30 days;
    uint256 private constant MAX_TTL = 365 days;

    /// @dev Min/max daily registration cap per passport. Min 1 keeps the system functional;
    ///      max 50 prevents a stolen passport from being used to mass-sigilize wallets.
    uint8 private constant MIN_DAILY_REGISTRATIONS = 1;
    uint8 private constant MAX_DAILY_REGISTRATIONS = 50;

    /// @dev BN254 scalar field prime. `hashedAddress` is `keccak256(wallet)`, a 256-bit value
    ///      that exceeds this prime ~81% of the time. The Mopro prover reduces it mod p when
    ///      forming the public inputs, so the on-chain verifier must reduce identically or
    ///      the Fiat-Shamir transcript diverges (SumcheckFailed).
    uint256 private constant BN254_PRIME =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // =========================================================================
    // Structs
    // =========================================================================

    /// @dev Tracks expiry and registration time for a single registered wallet.
    ///      `expiresAt = min(now + i_registrationTTL, ceil(passportExpiry / 90 days) * 90 days)`
    ///      `registeredAt` is set on first `register` and preserved across `renew`.
    struct Registration {
        uint48 expiresAt;
        uint48 registeredAt;
    }

    // =========================================================================
    // Immutables
    // =========================================================================

    IUltraHonkVerifier public immutable i_verifier;
    CSCAMerkleTree public immutable i_cscaMerkleTree;
    uint256 public immutable i_registrationTTL;
    uint8 public immutable i_maxDailyRegistrations;

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
    ///      `epochNullifier = Poseidon2(passport_secret, epoch_day)` where
    ///      `epoch_day = floor(block.timestamp / 1 days)`.
    mapping(bytes32 => uint8) private s_epochCounts;

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(
        IUltraHonkVerifier verifier_,
        address cscaMerkleTree_,
        uint256 registrationTTL_,
        uint8 maxDailyRegistrations_
    ) {
        if (address(verifier_) == address(0)) revert SigilRegistry__ZeroAddress();
        if (cscaMerkleTree_ == address(0)) revert SigilRegistry__ZeroAddress();
        if (registrationTTL_ < MIN_TTL || registrationTTL_ > MAX_TTL) {
            revert SigilRegistry__InvalidConfig();
        }
        if (
            maxDailyRegistrations_ < MIN_DAILY_REGISTRATIONS ||
            maxDailyRegistrations_ > MAX_DAILY_REGISTRATIONS
        ) {
            revert SigilRegistry__InvalidConfig();
        }

        i_verifier = verifier_;
        i_cscaMerkleTree = CSCAMerkleTree(cscaMerkleTree_);
        i_registrationTTL = registrationTTL_;
        i_maxDailyRegistrations = maxDailyRegistrations_;
    }

    // =========================================================================
    // Mutations
    // =========================================================================

    /// @inheritdoc ISigilRegistry
    function register(
        bytes32 nullifier,
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks
        if (block.timestamp >= passportExpiry) revert SigilRegistry__PassportExpired();
        if (s_registrations[hashedAddress].expiresAt > block.timestamp) revert SigilRegistry__AlreadyRegistered();

        uint8 count = s_epochCounts[epochNullifier];
        if (count >= i_maxDailyRegistrations) revert SigilRegistry__RateLimitExceeded();

        if (!_verifyProof(hashedAddress, nullifier, epochNullifier, proof)) {
            revert SigilRegistry__InvalidProof();
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

    /// @inheritdoc ISigilRegistry
    function renew(
        bytes32 nullifier,
        bytes32 epochNullifier,
        uint48 passportExpiry,
        bytes calldata proof
    ) external override nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));

        // Checks — must already be registered, and renewal must use the same nullifier.
        // To replace the passport (different nullifier), unregister first then register fresh.
        if (s_registrations[hashedAddress].expiresAt == 0) revert SigilRegistry__NotRegistered();
        if (s_nullifierByWallet[hashedAddress] != nullifier) revert SigilRegistry__NullifierMismatch();
        if (block.timestamp >= passportExpiry) revert SigilRegistry__PassportExpired();

        // The real epochNullifier is passed through to the verifier (the circuit always
        // constrains it). Rate limiting is NOT applied on renewals — `s_epochCounts` stays put.
        if (!_verifyProof(hashedAddress, nullifier, epochNullifier, proof)) {
            revert SigilRegistry__InvalidProof();
        }

        // Effects — preserve registeredAt; only extend expiresAt.
        s_registrations[hashedAddress].expiresAt = _cappedExpiry(passportExpiry);
    }

    /// @inheritdoc ISigilRegistry
    function unregister() external override nonReentrant {
        bytes32 hashedAddress = keccak256(abi.encodePacked(msg.sender));
        if (s_registrations[hashedAddress].expiresAt == 0) revert SigilRegistry__NotRegistered();

        bytes32 nullifier = s_nullifierByWallet[hashedAddress];
        _removeWalletFromArray(nullifier, msg.sender);

        delete s_registrations[hashedAddress];
        delete s_nullifierByWallet[hashedAddress];
        // No event — privacy requirement.
    }

    // =========================================================================
    // Protocol Integration
    // =========================================================================

    /// @inheritdoc ISigilRegistry
    function isVerified(address wallet) external view override returns (bool) {
        return s_registrations[keccak256(abi.encodePacked(wallet))].expiresAt > block.timestamp;
    }

    /// @inheritdoc ISigilRegistry
    function nullifierOf(address wallet) external view override returns (bytes32) {
        return s_nullifierByWallet[keccak256(abi.encodePacked(wallet))];
    }

    /// @inheritdoc ISigilRegistry
    function getExpiry(address wallet) external view override returns (uint48) {
        return s_registrations[keccak256(abi.encodePacked(wallet))].expiresAt;
    }

    /// @inheritdoc ISigilRegistry
    function getRegisteredAt(address wallet) external view override returns (uint48) {
        return s_registrations[keccak256(abi.encodePacked(wallet))].registeredAt;
    }

    /// @inheritdoc ISigilRegistry
    function getWallets(bytes32 nullifier) external view override returns (address[] memory) {
        return s_walletsByNullifier[nullifier];
    }

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    /// @dev Marshals public inputs into the bytes32[] array expected by the generated
    ///      UltraHonk verifier, preserving the circuit's declaration order:
    ///        [nullifier, epochNullifier, hashedAddress (mod p), cscaMerkleRoot].
    ///      `hashedAddress` is reduced mod the BN254 prime to match the prover.
    function _verifyProof(
        bytes32 hashedAddress,
        bytes32 nullifier,
        bytes32 epochNullifier,
        bytes calldata proof
    ) private view returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = nullifier;
        publicInputs[1] = epochNullifier;
        publicInputs[2] = bytes32(uint256(hashedAddress) % BN254_PRIME);
        publicInputs[3] = i_cscaMerkleTree.getRoot();
        return i_verifier.verify(proof, publicInputs);
    }

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
    ///        `min(now + i_registrationTTL, ceil(passportExpiry / 90 days) * 90 days)`
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
        uint48 ttlExpiry = uint48(block.timestamp) + uint48(i_registrationTTL);
        return ttlExpiry < roundedExpiry ? ttlExpiry : roundedExpiry;
    }
}
