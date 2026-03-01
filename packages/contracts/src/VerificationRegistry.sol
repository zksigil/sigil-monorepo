// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerificationRegistry} from "./interfaces/IVerificationRegistry.sol";
import {IGroth16Verifier} from "./interfaces/IGroth16Verifier.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VerificationRegistry
/// @notice On-chain registry linking Ethereum wallets to passport-verified identities.
/// @dev One verified address per passport at any time. Privacy model:
///      - No address↔nullifier mapping stored (not even in private storage)
///      - No nullifier in any event
///      - Unregistration uses a registration commitment to prove ownership
///      - Mandatory cooldown between unregister and re-register
contract VerificationRegistry is
    IVerificationRegistry,
    Ownable,
    Pausable,
    ReentrancyGuard
{
    // =========================================================================
    // Errors
    // =========================================================================

    error VerificationRegistry__NotRegistered();
    error VerificationRegistry__AlreadyRegistered();
    error VerificationRegistry__PassportAlreadyActive();
    error VerificationRegistry__PassportInCooldown();
    error VerificationRegistry__InvalidRegistrationCommitment();
    error VerificationRegistry__InvalidProof(string reason);
    error VerificationRegistry__ZeroAddress();
    error VerificationRegistry__VerifierCallFailed();

    // =========================================================================
    // Constants
    // =========================================================================

    uint256 public constant REREGISTRATION_COOLDOWN = 7 days;

    // =========================================================================
    // State Variables
    // =========================================================================

    /// @dev Total number of currently-verified wallets.
    uint256 private s_groupSize;

    /// @dev passportNullifier → currently registered?
    mapping(bytes32 => bool) private s_passportNullifierActive;

    /// @dev wallet address → verified?
    mapping(address => bool) private s_verifiedAddresses;

    /// @dev keccak256(abi.encode(passportNullifier, address)) → exists?
    mapping(bytes32 => bool) private s_registrationCommitments;

    /// @dev passportNullifier → cooldown expiry timestamp
    mapping(bytes32 => uint256) private s_passportCooldownUntil;

    /// @dev Address of the deployed ZK proof verifier contract.
    ///      When address(0), proof verification is skipped (dev/Phase 1 behavior).
    address private s_zkVerifierContract;

    // =========================================================================
    // Events (contract-level, not in interface)
    // =========================================================================

    /// @notice Emitted when the ZK verifier contract address is updated.
    event ZkVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address initialOwner) Ownable(initialOwner) {}

    // =========================================================================
    // External Functions
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function register(
        bytes calldata zkProof,
        bytes32 passportNullifier
    ) external override whenNotPaused nonReentrant {
        // --- Checks ---
        if (s_verifiedAddresses[msg.sender]) {
            revert VerificationRegistry__AlreadyRegistered();
        }
        if (s_passportNullifierActive[passportNullifier]) {
            revert VerificationRegistry__PassportAlreadyActive();
        }
        if (block.timestamp < s_passportCooldownUntil[passportNullifier]) {
            revert VerificationRegistry__PassportInCooldown();
        }

        _verifyZKProof(zkProof, passportNullifier);

        // --- Effects ---
        s_groupSize++;

        s_verifiedAddresses[msg.sender] = true;
        s_passportNullifierActive[passportNullifier] = true;

        bytes32 commitment = keccak256(abi.encode(passportNullifier, msg.sender));
        s_registrationCommitments[commitment] = true;

        emit WalletVerified(msg.sender, block.timestamp);
    }

    /// @inheritdoc IVerificationRegistry
    function unregister(bytes32 passportNullifier) external override whenNotPaused nonReentrant {
        // --- Checks ---
        if (!s_verifiedAddresses[msg.sender]) {
            revert VerificationRegistry__NotRegistered();
        }

        bytes32 commitment = keccak256(abi.encode(passportNullifier, msg.sender));
        if (!s_registrationCommitments[commitment]) {
            revert VerificationRegistry__InvalidRegistrationCommitment();
        }

        // --- Effects ---
        s_groupSize--;

        s_verifiedAddresses[msg.sender] = false;
        s_passportNullifierActive[passportNullifier] = false;
        s_registrationCommitments[commitment] = false;
        s_passportCooldownUntil[passportNullifier] = block.timestamp + REREGISTRATION_COOLDOWN;

        // NO event emitted — critical privacy requirement
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function isVerified(address wallet) external view override returns (bool) {
        return s_verifiedAddresses[wallet];
    }

    /// @inheritdoc IVerificationRegistry
    function getGroupSize() external view override returns (uint256) {
        return s_groupSize;
    }

    /// @notice Returns the ZK verifier contract address (address(0) if not set).
    function getZkVerifier() external view returns (address) {
        return s_zkVerifierContract;
    }

    // =========================================================================
    // Owner-Only Functions
    // =========================================================================

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set the ZK proof verifier contract address.
    /// @dev When a verifier is set, all register() calls must pass ZK proof verification.
    ///      Setting address(0) is disallowed after a verifier has been configured.
    function setZkVerifier(address verifierContract) external onlyOwner {
        if (verifierContract == address(0)) {
            revert VerificationRegistry__ZeroAddress();
        }
        address oldVerifier = s_zkVerifierContract;
        s_zkVerifierContract = verifierContract;
        emit ZkVerifierUpdated(oldVerifier, verifierContract);
    }

    // =========================================================================
    // Private Functions
    // =========================================================================

    /// @dev Verify the ZK proof via the external verifier when configured.
    ///      When s_zkVerifierContract is address(0), verification is skipped (Phase 1 compat).
    function _verifyZKProof(
        bytes calldata zkProof,
        bytes32 passportNullifier
    ) private view {
        if (s_zkVerifierContract == address(0)) {
            return;
        }

        // Public signals: [passportNullifier, walletAddress]
        uint256[] memory publicSignals = new uint256[](2);
        publicSignals[0] = uint256(passportNullifier);
        publicSignals[1] = uint256(uint160(msg.sender));

        try IGroth16Verifier(s_zkVerifierContract).verifyProof(zkProof, publicSignals) returns (bool valid) {
            if (!valid) {
                revert VerificationRegistry__InvalidProof("zk verification failed");
            }
        } catch {
            revert VerificationRegistry__VerifierCallFailed();
        }
    }
}
