// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {IVerificationRegistry} from "../src/interfaces/IVerificationRegistry.sol";
import {IProtocolConfig} from "../src/interfaces/IProtocolConfig.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {MockProofVerifier} from "./mocks/MockProofVerifier.sol";

contract VerificationRegistryTest is Test {
    VerificationRegistry public registry;
    ProtocolConfig public config;
    MockProofVerifier public verifier;

    address public governor = makeAddr("governor");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public attacker = makeAddr("attacker");

    // A passport expiry far in the future
    uint48 public constant PASSPORT_EXPIRY = type(uint48).max;
    bytes public constant PROOF = hex"";

    // Simulate epoch nullifiers (in prod: hash(s, "epoch", day))
    bytes32 public constant EPOCH_NULL_A = keccak256("epoch_A_day0");
    bytes32 public constant EPOCH_NULL_B = keccak256("epoch_B_day0");

    // Simulate primary nullifier chains for alice and bob
    // alice: s_a -> nullifier_1a, nullifier_2a, nullifier_3a
    bytes32 public constant NULL_1A = keccak256("alice_nullifier_1");
    bytes32 public constant NULL_2A = keccak256("alice_nullifier_2");
    bytes32 public constant NULL_3A = keccak256("alice_nullifier_3");
    bytes32 public immutable COMMIT_1A = keccak256(abi.encodePacked(NULL_2A)); // hash(nullifier_2a)
    bytes32 public immutable COMMIT_2A = keccak256(abi.encodePacked(NULL_3A)); // hash(nullifier_3a)

    bytes32 public constant NULL_1B = keccak256("bob_nullifier_1");
    bytes32 public constant NULL_2B = keccak256("bob_nullifier_2");
    bytes32 public immutable COMMIT_1B = keccak256(abi.encodePacked(NULL_2B));

    function setUp() public {
        config = new ProtocolConfig(governor);
        verifier = new MockProofVerifier();
        registry = new VerificationRegistry(governor, config, verifier);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _registerBase(address wallet, bytes32 epochNullifier) internal {
        vm.prank(wallet);
        registry.registerBase(epochNullifier, PASSPORT_EXPIRY, PROOF);
    }

    function _registerPrimary(address wallet, bytes32 nullifier, bytes32 nextCommitment) internal {
        vm.prank(wallet);
        registry.registerPrimary(nullifier, nextCommitment, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // Base Tier — Registration
    // =========================================================================

    function test_RegisterBase_Success() public {
        _registerBase(alice, EPOCH_NULL_A);
        assertTrue(registry.isVerified(alice));
    }

    function test_RegisterBase_EmitsWalletVerified() public {
        vm.expectEmit(true, false, false, false);
        emit IVerificationRegistry.WalletVerified(alice);

        _registerBase(alice, EPOCH_NULL_A);
    }

    function test_RegisterBase_Reverts_AlreadyRegistered() public {
        _registerBase(alice, EPOCH_NULL_A);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__AlreadyRegistered.selector);
        registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterBase_Reverts_PassportExpired() public {
        uint48 expiredPassport = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.registerBase(EPOCH_NULL_A, expiredPassport, PROOF);
    }

    function test_RegisterBase_Reverts_InvalidProof() public {
        verifier.setReject(true);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__InvalidProof.selector);
        registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterBase_Reverts_WhenPaused() public {
        vm.prank(governor);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterBase_MultipleAddresses_SamePassport() public {
        // Base tier allows multiple addresses per passport (epoch nullifiers differ each day)
        _registerBase(alice, EPOCH_NULL_A);
        _registerBase(bob, EPOCH_NULL_B);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
    }

    // =========================================================================
    // Base Tier — Rate Limiting
    // =========================================================================

    function test_RegisterBase_RateLimit_BlocksEleventhRegistration() public {
        // Register 10 times from different wallets using same epoch nullifier
        for (uint256 i = 0; i < 10; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
        }

        // 11th should fail
        vm.prank(attacker);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__RateLimitExceeded.selector);
        registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterBase_RateLimit_DifferentEpochAllows() public {
        // Fill up epoch nullifier A
        for (uint256 i = 0; i < 10; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
        }

        // Different epoch nullifier (different day) should still work
        _registerBase(alice, EPOCH_NULL_B);
        assertTrue(registry.isVerified(alice));
    }

    function test_RegisterBase_RateLimit_CanBeReducedByGovernor() public {
        vm.prank(governor);
        config.setMaxDailyRegistrations(2);

        _registerBase(alice, EPOCH_NULL_A);
        _registerBase(bob, EPOCH_NULL_A);

        vm.prank(carol);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__RateLimitExceeded.selector);
        registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // Base Tier — Expiry
    // =========================================================================

    function test_RegisterBase_ExpiresAfterTTL() public {
        _registerBase(alice, EPOCH_NULL_A);
        assertTrue(registry.isVerified(alice));

        // Warp past TTL
        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_RegisterBase_ExpiresAtPassportExpiry_WhenEarlierThanTTL() public {
        uint48 nearExpiry = uint48(block.timestamp + 30 days); // less than 180 day TTL

        vm.prank(alice);
        registry.registerBase(EPOCH_NULL_A, nearExpiry, PROOF);
        assertTrue(registry.isVerified(alice));

        // Warp to just after passport expiry
        vm.warp(uint256(nearExpiry) + 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_RegisterBase_IsVerified_ReturnsFalseLazily() public {
        _registerBase(alice, EPOCH_NULL_A);

        vm.warp(block.timestamp + config.registrationTTL() + 1);

        // No state write needed — just reads return false
        assertFalse(registry.isVerified(alice));

        // Can re-register after expiry with new epoch nullifier
        bytes32 newEpochNull = keccak256("epoch_A_day999");
        _registerBase(alice, newEpochNull);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // Base Tier — Renewal
    // =========================================================================

    function test_RenewBase_ExtendsExpiry() public {
        _registerBase(alice, EPOCH_NULL_A);

        // Warp to 1 day before expiry
        vm.warp(block.timestamp + config.registrationTTL() - 1 days);
        assertTrue(registry.isVerified(alice));

        // Renew
        vm.prank(alice);
        registry.renewBase(PASSPORT_EXPIRY, PROOF);

        // Should now be valid for another full TTL
        vm.warp(block.timestamp + config.registrationTTL() - 1);
        assertTrue(registry.isVerified(alice));
    }

    function test_RenewBase_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.renewBase(PASSPORT_EXPIRY, PROOF);
    }

    function test_RenewBase_Reverts_PassportExpired() public {
        _registerBase(alice, EPOCH_NULL_A);
        uint48 expiredPassport = uint48(block.timestamp - 1);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.renewBase(expiredPassport, PROOF);
    }

    function test_RenewBase_DoesNotConsumeRateLimit() public {
        _registerBase(alice, EPOCH_NULL_A);

        // Fill up rate limit with other wallets
        for (uint256 i = 0; i < 9; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);
        }
        // Rate limit is now at 10/10

        // Alice can still renew (renewal doesn't use epoch nullifier)
        vm.prank(alice);
        registry.renewBase(PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // Primary Tier — Registration
    // =========================================================================

    function test_RegisterPrimary_Success() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function test_RegisterPrimary_EmitsWalletVerified() public {
        vm.expectEmit(true, false, false, false);
        emit IVerificationRegistry.WalletVerified(alice);

        _registerPrimary(alice, NULL_1A, COMMIT_1A);
    }

    function test_RegisterPrimary_Reverts_NullifierAlreadyUsed() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        // Bob tries to register with the same nullifier
        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NullifierAlreadyUsed.selector);
        registry.registerPrimary(NULL_1A, COMMIT_1A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterPrimary_Reverts_AlreadyRegistered() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        // Alice tries to register again with a different nullifier
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__AlreadyRegistered.selector);
        registry.registerPrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterPrimary_Reverts_PassportExpired() public {
        uint48 expired = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.registerPrimary(NULL_1A, COMMIT_1A, expired, PROOF);
    }

    function test_RegisterPrimary_StoresSlot() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        (bytes32 storedAddress, bytes32 storedCommitment) = registry.s_primarySlots(NULL_1A);
        assertEq(storedAddress, keccak256(abi.encodePacked(alice)));
        assertEq(storedCommitment, COMMIT_1A);
    }

    // =========================================================================
    // Primary Tier — Expiry
    // =========================================================================

    function test_RegisterPrimary_ExpiresAfterTTL() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        assertTrue(registry.isPrimaryVerified(alice));

        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isPrimaryVerified(alice));
    }

    function test_RegisterPrimary_ExpiresAtPassportExpiry_WhenEarlier() public {
        uint48 nearExpiry = uint48(block.timestamp + 30 days);
        vm.prank(alice);
        registry.registerPrimary(NULL_1A, COMMIT_1A, nearExpiry, PROOF);

        vm.warp(uint256(nearExpiry) + 1);
        assertFalse(registry.isPrimaryVerified(alice));
    }

    // =========================================================================
    // Primary Tier — Renewal
    // =========================================================================

    function test_RenewPrimary_ExtendsExpiry() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        vm.warp(block.timestamp + config.registrationTTL() - 1 days);

        vm.prank(alice);
        registry.renewPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);

        vm.warp(block.timestamp + config.registrationTTL() - 1);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function test_RenewPrimary_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.renewPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RenewPrimary_Reverts_NotAuthorized() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        // Bob tries to renew alice's slot
        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotAuthorized.selector);
        registry.renewPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // Primary Tier — changePrimary
    // =========================================================================

    function test_ChangePrimary_MovesToNewAddress() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        assertTrue(registry.isPrimaryVerified(alice));
        assertFalse(registry.isPrimaryVerified(bob));

        // Bob takes over alice's primary slot by revealing nullifier_2a
        vm.prank(bob);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);

        assertFalse(registry.isPrimaryVerified(alice));
        assertTrue(registry.isPrimaryVerified(bob));
    }

    function test_ChangePrimary_OldSlotDeleted() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(bob);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);

        // Old slot for NULL_1A should be gone
        (bytes32 oldAddress,) = registry.s_primarySlots(NULL_1A);
        assertEq(oldAddress, bytes32(0));
    }

    function test_ChangePrimary_NewSlotStored() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(bob);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);

        // New slot should use NULL_2A as key
        (bytes32 newAddress, bytes32 newCommitment) = registry.s_primarySlots(NULL_2A);
        assertEq(newAddress, keccak256(abi.encodePacked(bob)));
        assertEq(newCommitment, COMMIT_2A);
    }

    function test_ChangePrimary_CanChainAgain() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(bob);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);

        // Can chain again using NULL_3A
        bytes32 commit3a = keccak256(abi.encodePacked(keccak256("alice_nullifier_4")));
        vm.prank(carol);
        registry.changePrimary(NULL_3A, commit3a, PASSPORT_EXPIRY, PROOF);

        assertFalse(registry.isPrimaryVerified(bob));
        assertTrue(registry.isPrimaryVerified(carol));
    }

    function test_ChangePrimary_SameAddress() public {
        // Alice can change to herself (e.g. to rotate nullifier after TTL concern)
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(alice);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);

        assertTrue(registry.isPrimaryVerified(alice));
        (bytes32 newAddress,) = registry.s_primarySlots(NULL_2A);
        assertEq(newAddress, keccak256(abi.encodePacked(alice)));
    }

    function test_ChangePrimary_Reverts_InvalidNextNullifier() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        // Reveal a nullifier that doesn't match any stored commitment
        bytes32 wrongNullifier = keccak256("wrong_nullifier");
        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__InvalidNextNullifier.selector);
        registry.changePrimary(wrongNullifier, COMMIT_2A, PASSPORT_EXPIRY, PROOF);
    }

    function test_ChangePrimary_Reverts_PassportExpired() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        uint48 expired = uint48(block.timestamp - 1);

        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.changePrimary(NULL_2A, COMMIT_2A, expired, PROOF);
    }

    function test_ChangePrimary_EmitsWalletVerified() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.expectEmit(true, false, false, false);
        emit IVerificationRegistry.WalletVerified(bob);

        vm.prank(bob);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // Primary Tier — unregisterPrimary
    // =========================================================================

    function test_UnregisterPrimary_Success() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        assertTrue(registry.isPrimaryVerified(alice));

        vm.prank(alice);
        registry.unregisterPrimary(NULL_1A);

        assertFalse(registry.isPrimaryVerified(alice));
    }

    function test_UnregisterPrimary_NoEventEmitted() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);
        vm.recordLogs();

        vm.prank(alice);
        registry.unregisterPrimary(NULL_1A);

        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_UnregisterPrimary_SetsSlotToCooldown() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(alice);
        registry.unregisterPrimary(NULL_1A);

        // Immediate re-register with same nullifier should be blocked by cooldown
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PrimaryInCooldown.selector);
        registry.registerPrimary(NULL_1A, COMMIT_1A, PASSPORT_EXPIRY, PROOF);
    }

    function test_UnregisterPrimary_AllowsReregister_AfterCooldown() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(alice);
        registry.unregisterPrimary(NULL_1A);

        vm.warp(block.timestamp + config.cooldownPeriod());

        vm.prank(alice);
        registry.registerPrimary(NULL_1A, COMMIT_1A, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function test_UnregisterPrimary_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregisterPrimary(NULL_1A);
    }

    function test_UnregisterPrimary_Reverts_NotAuthorized() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(attacker);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotAuthorized.selector);
        registry.unregisterPrimary(NULL_1A);
    }

    // =========================================================================
    // Privacy properties
    // =========================================================================

    function test_Privacy_BaseTierUnlinkable() public {
        _registerBase(alice, EPOCH_NULL_A);
        _registerBase(bob, EPOCH_NULL_B);

        // Both verified; no way to link them to the same passport
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
    }

    function test_Privacy_BasePrimaryUnlinkable() public {
        // Same passport registers both base and primary — tiers must be unlinkable
        _registerBase(alice, EPOCH_NULL_A);
        _registerPrimary(bob, NULL_1A, COMMIT_1A);

        // No shared state links alice (base) and bob (primary)
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isPrimaryVerified(bob));
        assertFalse(registry.isPrimaryVerified(alice));
        assertFalse(registry.isVerified(bob));
    }

    function test_Privacy_ChangePrimary_OldNullifierGone() public {
        _registerPrimary(alice, NULL_1A, COMMIT_1A);

        vm.prank(bob);
        registry.changePrimary(NULL_2A, COMMIT_2A, PASSPORT_EXPIRY, PROOF);

        // NULL_1A slot is gone — no way to link old and new on-chain
        (bytes32 storedAddr,) = registry.s_primarySlots(NULL_1A);
        assertEq(storedAddr, bytes32(0));
    }

    // =========================================================================
    // Successor / Migration
    // =========================================================================

    function test_Successor_IsVerified_Delegates() public {
        _registerBase(alice, EPOCH_NULL_A);

        // Deploy a new registry and set it as successor
        VerificationRegistry successor = new VerificationRegistry(governor, config, verifier);

        // Register alice on the new registry too
        vm.prank(alice);
        successor.registerBase(EPOCH_NULL_A, PASSPORT_EXPIRY, PROOF);

        vm.prank(governor);
        registry.setSuccessor(address(successor));

        // Old registry now delegates to successor
        assertTrue(registry.isVerified(alice));
        assertFalse(registry.isVerified(bob));
    }

    // =========================================================================
    // Governance
    // =========================================================================

    function test_TransferGovernance_Success() public {
        address newGov = makeAddr("newGov");
        vm.prank(governor);
        registry.transferGovernance(newGov);
        assertEq(registry.s_governor(), newGov);
    }

    function test_TransferGovernance_Reverts_NonGovernor() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotGovernor.selector);
        registry.transferGovernance(alice);
    }

    function test_SetConfig_Success() public {
        ProtocolConfig newConfig = new ProtocolConfig(governor);
        vm.prank(governor);
        registry.setConfig(newConfig);
        assertEq(address(registry.s_config()), address(newConfig));
    }

    function test_SetConfig_EmitsEvent() public {
        ProtocolConfig newConfig = new ProtocolConfig(governor);
        vm.expectEmit(true, true, false, false);
        emit IVerificationRegistry.ConfigUpdated(address(config), address(newConfig));

        vm.prank(governor);
        registry.setConfig(newConfig);
    }

    function test_SetVerifier_Success() public {
        MockProofVerifier newVerifier = new MockProofVerifier();
        vm.prank(governor);
        registry.setVerifier(newVerifier);
        assertEq(address(registry.s_verifier()), address(newVerifier));
    }

    function test_SetOracleUpdater_Success() public {
        address oracle = makeAddr("oracle");
        vm.prank(governor);
        registry.setOracleUpdater(oracle);
        assertEq(registry.s_oracleUpdater(), oracle);
    }

    function test_UpdateDSCRoot_Success() public {
        address oracle = makeAddr("oracle");
        vm.prank(governor);
        registry.setOracleUpdater(oracle);

        bytes32 newRoot = keccak256("new_dsc_root");
        vm.prank(oracle);
        registry.updateDSCRoot(newRoot);
        assertEq(registry.s_dscMerkleRoot(), newRoot);
    }

    function test_UpdateDSCRoot_Reverts_NonOracle() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotAuthorized.selector);
        registry.updateDSCRoot(keccak256("root"));
    }

    function test_Pause_OnlyGovernor() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotGovernor.selector);
        registry.pause();
    }

    function test_Unpause_AllowsRegistration() public {
        vm.prank(governor);
        registry.pause();

        vm.prank(governor);
        registry.unpause();

        _registerBase(alice, EPOCH_NULL_A);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_RegisterBase_RandomEpochNullifiers(bytes32 epochNull) public {
        vm.prank(alice);
        registry.registerBase(epochNull, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isVerified(alice));
    }

    function testFuzz_RegisterPrimary_RandomNullifiers(bytes32 nullifier, bytes32 commitment) public {
        vm.assume(nullifier != bytes32(0) && commitment != bytes32(0));
        vm.prank(alice);
        registry.registerPrimary(nullifier, commitment, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function testFuzz_Expiry_NeverActiveAfterPassportExpiry(uint48 passportExpiry) public {
        // Keep passportExpiry in a reasonable future range
        passportExpiry = uint48(bound(passportExpiry, block.timestamp + 1, block.timestamp + 10 * 365 days));

        vm.prank(alice);
        registry.registerBase(EPOCH_NULL_A, passportExpiry, PROOF);

        vm.warp(uint256(passportExpiry) + 1);
        assertFalse(registry.isVerified(alice));
    }
}
