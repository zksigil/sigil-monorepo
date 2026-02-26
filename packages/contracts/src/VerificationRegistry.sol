// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerificationRegistry} from "./interfaces/IVerificationRegistry.sol";
import {IGroth16Verifier} from "./interfaces/IGroth16Verifier.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VerificationRegistry
/// @notice On-chain registry linking Ethereum wallets to passport-verified identities.
/// @dev Phase 1 skeleton — ZK proof verification is a stub (always passes).
///      Phase 2 will integrate the actual zkPassport groth16 verifier contract.
///
///      Security model:
///      - One nullifier can link to N wallets (a single passport may control multiple wallets)
///      - One wallet links to exactly one nullifier at a time
///      - Wallets supply their own Semaphore identity commitment (no server involvement)
///      - The contract owner can pause registration in emergencies
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
    error VerificationRegistry__InvalidProof(string reason);
    error VerificationRegistry__ZeroAddress();
    error VerificationRegistry__ZeroIdentityCommitment();
    error VerificationRegistry__VerifierCallFailed();

    // =========================================================================
    // Type Declarations
    // =========================================================================

    /// @dev Internal record linking a wallet to its nullifier.
    struct WalletRecord {
        bytes32 nullifier;
        bool active;
    }

    // =========================================================================
    // State Variables
    // =========================================================================

    /// @dev Total number of currently-verified wallets.
    uint256 private s_groupSize;

    /// @dev wallet address => WalletInfo (public query data)
    mapping(address wallet => WalletInfo) private s_walletInfo;

    /// @dev wallet address => WalletRecord (internal bookkeeping)
    mapping(address wallet => WalletRecord) private s_walletRecords;

    /// @dev nullifier => NullifierInfo
    mapping(bytes32 nullifier => NullifierInfo) private s_nullifierInfo;

    /// @dev Address of the deployed zkPassport groth16 verifier.
    ///      When address(0), proof verification is skipped (Phase 1 behavior).
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
        bytes32 nullifier,
        uint256 semaphoreIdentityCommitment
    ) external override whenNotPaused nonReentrant {
        // --- Checks ---
        if (s_walletInfo[msg.sender].verified) {
            revert VerificationRegistry__AlreadyRegistered();
        }
        if (semaphoreIdentityCommitment == 0) {
            revert VerificationRegistry__ZeroIdentityCommitment();
        }

        // ZK proof verification (Phase 1 stub — always succeeds)
        _verifyZKProof(zkProof, nullifier, semaphoreIdentityCommitment);

        // --- Effects ---
        uint256 newGroupSize = s_groupSize + 1;
        s_groupSize = newGroupSize;

        s_walletInfo[msg.sender] = WalletInfo({
            verified: true,
            previouslyUnregistered: s_walletInfo[msg.sender].previouslyUnregistered,
            groupSizeAtVerification: newGroupSize,
            verifiedAt: block.timestamp,
            identityCommitment: semaphoreIdentityCommitment
        });

        s_walletRecords[msg.sender] = WalletRecord({
            nullifier: nullifier,
            active: true
        });

        NullifierInfo storage nullifierInfo = s_nullifierInfo[nullifier];
        nullifierInfo.currentCount += 1;
        nullifierInfo.currentCountSince = block.timestamp;
        if (nullifierInfo.currentCount > nullifierInfo.peakCount) {
            nullifierInfo.peakCount = nullifierInfo.currentCount;
            nullifierInfo.peakCountAchieved = block.timestamp;
            if (nullifierInfo.peakCountSince == 0) {
                nullifierInfo.peakCountSince = block.timestamp;
            }
        }

        emit WalletRegistered(msg.sender, nullifier, newGroupSize, block.timestamp);
    }

    /// @inheritdoc IVerificationRegistry
    function unregister() external override whenNotPaused nonReentrant {
        // --- Checks ---
        if (!s_walletInfo[msg.sender].verified) {
            revert VerificationRegistry__NotRegistered();
        }

        // --- Effects ---
        bytes32 nullifier = s_walletRecords[msg.sender].nullifier;
        uint256 newGroupSize = s_groupSize - 1;
        s_groupSize = newGroupSize;

        s_walletInfo[msg.sender].verified = false;
        s_walletInfo[msg.sender].previouslyUnregistered = true;
        s_walletRecords[msg.sender].active = false;

        s_nullifierInfo[nullifier].currentCount -= 1;

        emit WalletUnregistered(msg.sender, nullifier, newGroupSize, block.timestamp);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// @inheritdoc IVerificationRegistry
    function isVerified(address wallet) external view override returns (bool) {
        return s_walletInfo[wallet].verified;
    }

    /// @inheritdoc IVerificationRegistry
    function getWalletInfo(address wallet)
        external
        view
        override
        returns (WalletInfo memory)
    {
        return s_walletInfo[wallet];
    }

    /// @inheritdoc IVerificationRegistry
    function getNullifierInfo(bytes32 nullifier)
        external
        view
        override
        returns (NullifierInfo memory)
    {
        return s_nullifierInfo[nullifier];
    }

    /// @notice Returns the total number of currently-verified wallets.
    function getGroupSize() external view returns (uint256) {
        return s_groupSize;
    }

    /// @notice Returns the ZK verifier contract address (address(0) in Phase 1).
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

    /// @notice Set the ZK verifier contract address.
    /// @dev When a verifier is set, all register() calls must pass Groth16 verification.
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

    /// @dev Verify the ZK proof via the external Groth16 verifier when configured.
    ///      When s_zkVerifierContract is address(0), verification is skipped (Phase 1 compat).
    function _verifyZKProof(
        bytes calldata zkProof,
        bytes32 nullifier,
        uint256 commitment
    ) private view {
        if (s_zkVerifierContract == address(0)) {
            // No verifier set — Phase 1 pass-through
            return;
        }

        // Build public signals array: [nullifier, commitment, walletAddress]
        uint256[] memory publicSignals = new uint256[](3);
        publicSignals[0] = uint256(nullifier);
        publicSignals[1] = commitment;
        publicSignals[2] = uint256(uint160(msg.sender));

        // Call the external verifier — wrap in try/catch to give a clear error
        try IGroth16Verifier(s_zkVerifierContract).verifyProof(zkProof, publicSignals) returns (bool valid) {
            if (!valid) {
                revert VerificationRegistry__InvalidProof("groth16 verification failed");
            }
        } catch {
            revert VerificationRegistry__VerifierCallFailed();
        }
    }
}
