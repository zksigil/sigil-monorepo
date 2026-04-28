// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";
import {IVerificationRegistry} from "../src/interfaces/IVerificationRegistry.sol";
import {IProtocolConfig} from "../src/interfaces/IProtocolConfig.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {MockProofVerifier} from "./mocks/MockProofVerifier.sol";

contract VerificationRegistryTest is Test {
    VerificationRegistry public registry;
    ProtocolConfig public config;
    MockProofVerifier public verifier;
    CSCAMerkleTree public cscaTree;

    address public governor = makeAddr("governor");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public attacker = makeAddr("attacker");

    // A passport expiry far in the future
    uint48 public constant PASSPORT_EXPIRY = type(uint48).max;
    bytes public constant PROOF = hex"";

    bytes32 public constant CSCA_MERKLE_ROOT = 0x06db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de;

    // Simulate epoch nullifiers (in prod: hash(s, "epoch", day))
    bytes32 public constant EPOCH_NULL_A = keccak256("epoch_A_day0");
    bytes32 public constant EPOCH_NULL_B = keccak256("epoch_B_day0");

    // Primary nullifiers — deterministic per passport in production. NULL_2A is unrelated
    // to NULL_1A and is used in tests that need a "different passport" nullifier.
    bytes32 public constant NULL_1A = keccak256("alice_nullifier_1");
    bytes32 public constant NULL_2A = keccak256("alice_nullifier_2");

    function setUp() public {
        config = new ProtocolConfig(governor);
        verifier = new MockProofVerifier();
        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, governor);
        registry = new VerificationRegistry(governor, config, verifier, address(cscaTree));
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _registerBase(address wallet, bytes32 epochNullifier) internal {
        vm.prank(wallet);
        registry.registerBase(epochNullifier, PASSPORT_EXPIRY, PROOF);
    }

    function _registerPrimary(address wallet, bytes32 nullifier) internal {
        vm.prank(wallet);
        registry.registerPrimary(nullifier, PASSPORT_EXPIRY, PROOF);
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
        // 30 days < 180-day TTL. Rounds UP to the next quarter boundary (90 days from epoch).
        uint48 rawExpiry = uint48(block.timestamp + 30 days);
        uint48 roundedExpiry = ((rawExpiry + 90 days - 1) / 90 days) * 90 days;

        vm.prank(alice);
        registry.registerBase(EPOCH_NULL_A, rawExpiry, PROOF);
        assertTrue(registry.isVerified(alice));

        // Still verified just before rounded expiry
        vm.warp(uint256(roundedExpiry) - 1);
        assertTrue(registry.isVerified(alice));

        // Lapses just after rounded expiry
        vm.warp(uint256(roundedExpiry) + 1);
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
    // Base Tier — Unregister
    // =========================================================================

    function test_UnregisterBase_Success() public {
        _registerBase(alice, EPOCH_NULL_A);
        assertTrue(registry.isVerified(alice));

        vm.prank(alice);
        registry.unregisterBase();

        assertFalse(registry.isVerified(alice));
    }

    function test_UnregisterBase_NoEventEmitted() public {
        _registerBase(alice, EPOCH_NULL_A);
        vm.recordLogs();

        vm.prank(alice);
        registry.unregisterBase();

        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_UnregisterBase_AllowsReregister() public {
        _registerBase(alice, EPOCH_NULL_A);

        vm.prank(alice);
        registry.unregisterBase();

        // Can re-register immediately with a new epoch nullifier
        bytes32 newEpochNull = keccak256("epoch_A_day2");
        _registerBase(alice, newEpochNull);
        assertTrue(registry.isVerified(alice));
    }

    function test_UnregisterBase_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregisterBase();
    }

    // =========================================================================
    // Primary Tier — Registration
    // =========================================================================

    function test_RegisterPrimary_Success() public {
        _registerPrimary(alice, NULL_1A);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function test_RegisterPrimary_EmitsWalletVerified() public {
        vm.expectEmit(true, false, false, false);
        emit IVerificationRegistry.WalletVerified(alice);

        _registerPrimary(alice, NULL_1A);
    }

    function test_RegisterPrimary_Reverts_NullifierAlreadyUsed() public {
        _registerPrimary(alice, NULL_1A);

        // Bob tries to register with the same nullifier
        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NullifierAlreadyUsed.selector);
        registry.registerPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterPrimary_Reverts_AlreadyRegistered() public {
        _registerPrimary(alice, NULL_1A);

        // Alice tries to register again with a different nullifier
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__AlreadyRegistered.selector);
        registry.registerPrimary(NULL_2A, PASSPORT_EXPIRY, PROOF);
    }

    function test_RegisterPrimary_Reverts_PassportExpired() public {
        uint48 expired = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.registerPrimary(NULL_1A, expired, PROOF);
    }

    function test_RegisterPrimary_StoresSlot() public {
        _registerPrimary(alice, NULL_1A);

        bytes32 storedAddress = registry.s_primarySlots(NULL_1A);
        assertEq(storedAddress, keccak256(abi.encodePacked(alice)));
    }

    function test_RegisterPrimary_ClearsStaleSlot_WhenWalletRotatesPassport() public {
        // Alice registers with passport A (NULL_1A).
        _registerPrimary(alice, NULL_1A);
        bytes32 hashedAlice = keccak256(abi.encodePacked(alice));
        assertEq(registry.s_primarySlots(NULL_1A), hashedAlice);

        // Registration lapses (TTL passed, no renewal). Note: real passport with finite
        // expiry would also need to still be valid; PASSPORT_EXPIRY = uint48.max here.
        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isPrimaryVerified(alice));

        // Alice re-registers with a new passport (NULL_2A).
        vm.prank(alice);
        registry.registerPrimary(NULL_2A, PASSPORT_EXPIRY, PROOF);

        // Stale slot from old passport is cleared; new slot points at alice.
        assertEq(registry.s_primarySlots(NULL_1A), bytes32(0));
        assertEq(registry.s_primarySlots(NULL_2A), hashedAlice);
        assertEq(registry.s_primaryNullifierByWallet(hashedAlice), NULL_2A);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function test_RegisterPrimary_DoesNotClearOtherWalletsSlots() public {
        // Bob registers first with NULL_2A.
        _registerPrimary(bob, NULL_2A);
        bytes32 hashedBob = keccak256(abi.encodePacked(bob));

        // Alice registers fresh with NULL_1A — she has no prior slot.
        _registerPrimary(alice, NULL_1A);

        // Bob's slot is untouched.
        assertEq(registry.s_primarySlots(NULL_2A), hashedBob);
        assertTrue(registry.isPrimaryVerified(bob));
    }

    // =========================================================================
    // Primary Tier — Expiry
    // =========================================================================

    function test_RegisterPrimary_ExpiresAfterTTL() public {
        _registerPrimary(alice, NULL_1A);
        assertTrue(registry.isPrimaryVerified(alice));

        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isPrimaryVerified(alice));
    }

    function test_RegisterPrimary_ExpiresAtPassportExpiry_WhenEarlier() public {
        // 30 days < 180-day TTL. Rounds UP to the next quarter boundary.
        uint48 rawExpiry = uint48(block.timestamp + 30 days);
        uint48 roundedExpiry = ((rawExpiry + 90 days - 1) / 90 days) * 90 days;

        vm.prank(alice);
        registry.registerPrimary(NULL_1A, rawExpiry, PROOF);

        // Still verified just before rounded expiry
        vm.warp(uint256(roundedExpiry) - 1);
        assertTrue(registry.isPrimaryVerified(alice));

        // Lapses just after rounded expiry
        vm.warp(uint256(roundedExpiry) + 1);
        assertFalse(registry.isPrimaryVerified(alice));
    }

    // =========================================================================
    // Primary Tier — Renewal
    // =========================================================================

    function test_RenewPrimary_ExtendsExpiry() public {
        _registerPrimary(alice, NULL_1A);
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
        _registerPrimary(alice, NULL_1A);

        // Bob tries to renew alice's slot
        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotAuthorized.selector);
        registry.renewPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // Primary Tier — unregisterPrimary
    // =========================================================================

    function test_UnregisterPrimary_Success() public {
        _registerPrimary(alice, NULL_1A);
        assertTrue(registry.isPrimaryVerified(alice));

        vm.prank(alice);
        registry.unregisterPrimary();

        assertFalse(registry.isPrimaryVerified(alice));
    }

    function test_UnregisterPrimary_NoEventEmitted() public {
        _registerPrimary(alice, NULL_1A);
        vm.recordLogs();

        vm.prank(alice);
        registry.unregisterPrimary();

        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_UnregisterPrimary_SetsSlotToCooldown() public {
        _registerPrimary(alice, NULL_1A);

        vm.prank(alice);
        registry.unregisterPrimary();

        // Immediate re-register with same nullifier should be blocked by cooldown
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PrimaryInCooldown.selector);
        registry.registerPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
    }

    function test_UnregisterPrimary_AllowsReregister_AfterCooldown() public {
        _registerPrimary(alice, NULL_1A);

        vm.prank(alice);
        registry.unregisterPrimary();

        vm.warp(block.timestamp + config.cooldownPeriod());

        vm.prank(alice);
        registry.registerPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    /// @notice After cooldown, a different wallet can register the same nullifier — this is
    ///         the explicit primary-switch flow. Old + new addresses are linkable on-chain
    ///         via the shared nullifier.
    function test_UnregisterPrimary_DifferentWallet_CanReregister_AfterCooldown() public {
        _registerPrimary(alice, NULL_1A);

        vm.prank(alice);
        registry.unregisterPrimary();

        vm.warp(block.timestamp + config.cooldownPeriod());

        vm.prank(bob);
        registry.registerPrimary(NULL_1A, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isPrimaryVerified(bob));
        assertFalse(registry.isPrimaryVerified(alice));
    }

    function test_UnregisterPrimary_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregisterPrimary();
    }

    function test_UnregisterPrimary_Reverts_AttackerHasNoSlot() public {
        _registerPrimary(alice, NULL_1A);

        // Attacker has no primary slot, so lookup returns zero → NotRegistered.
        // (Alice's slot is unaffected.)
        vm.prank(attacker);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregisterPrimary();
    }

    // =========================================================================
    // s_primaryNullifierByWallet — reverse mapping for unregister lookup
    // =========================================================================

    function test_PrimaryNullifierByWallet_ZeroBeforeRegister() public view {
        bytes32 hashedAlice = keccak256(abi.encodePacked(alice));
        assertEq(registry.s_primaryNullifierByWallet(hashedAlice), bytes32(0));
    }

    function test_PrimaryNullifierByWallet_SetAfterRegister() public {
        _registerPrimary(alice, NULL_1A);
        bytes32 hashedAlice = keccak256(abi.encodePacked(alice));
        assertEq(registry.s_primaryNullifierByWallet(hashedAlice), NULL_1A);
    }

    function test_PrimaryNullifierByWallet_ClearedOnUnregister() public {
        _registerPrimary(alice, NULL_1A);
        vm.prank(alice);
        registry.unregisterPrimary();

        bytes32 hashedAlice = keccak256(abi.encodePacked(alice));
        assertEq(registry.s_primaryNullifierByWallet(hashedAlice), bytes32(0));
    }

    // =========================================================================
    // wasNullifierUsed — used by app to distinguish first-tap vs returning passport
    // =========================================================================

    function test_WasNullifierUsed_FalseInitially() public view {
        assertFalse(registry.wasNullifierUsed(NULL_1A));
    }

    function test_WasNullifierUsed_TrueAfterRegister() public {
        _registerPrimary(alice, NULL_1A);
        assertTrue(registry.wasNullifierUsed(NULL_1A));
    }

    function test_WasNullifierUsed_TrueAfterUnregister() public {
        _registerPrimary(alice, NULL_1A);
        vm.prank(alice);
        registry.unregisterPrimary();

        assertTrue(registry.wasNullifierUsed(NULL_1A));
    }

    function test_WasNullifierUsed_TrueAfterCooldownElapsed() public {
        _registerPrimary(alice, NULL_1A);
        vm.prank(alice);
        registry.unregisterPrimary();
        vm.warp(block.timestamp + config.cooldownPeriod() + 1);

        // Cooldown is over but the nullifier is still flagged as previously used
        assertTrue(registry.wasNullifierUsed(NULL_1A));
    }

    function test_WasNullifierUsed_FalseForUnrelatedNullifier() public {
        _registerPrimary(alice, NULL_1A);
        assertFalse(registry.wasNullifierUsed(NULL_2A));
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
        _registerPrimary(bob, NULL_1A);

        // No shared state links alice (base) and bob (primary)
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isPrimaryVerified(bob));
        assertFalse(registry.isPrimaryVerified(alice));
        assertFalse(registry.isVerified(bob));
    }

    // =========================================================================
    // Successor / Migration
    // =========================================================================

    function test_Successor_IsVerified_Delegates() public {
        _registerBase(alice, EPOCH_NULL_A);

        // Deploy a new registry and set it as successor
        VerificationRegistry successor = new VerificationRegistry(governor, config, verifier, address(cscaTree));

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

    function testFuzz_RegisterPrimary_RandomNullifiers(bytes32 nullifier) public {
        vm.assume(nullifier != bytes32(0));
        vm.prank(alice);
        registry.registerPrimary(nullifier, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isPrimaryVerified(alice));
    }

    function testFuzz_Expiry_NeverActiveAfterPassportExpiry(uint48 passportExpiry) public {
        // Keep passportExpiry in a reasonable future range
        passportExpiry = uint48(bound(passportExpiry, block.timestamp + 1, block.timestamp + 10 * 365 days));

        // Round UP to quarter boundary — the effective ceiling stored on-chain
        uint48 roundedExpiry = passportExpiry <= type(uint48).max - (90 days - 1)
            ? ((passportExpiry + 90 days - 1) / 90 days) * 90 days
            : passportExpiry;

        vm.prank(alice);
        registry.registerBase(EPOCH_NULL_A, passportExpiry, PROOF);

        vm.warp(uint256(roundedExpiry) + 1);
        assertFalse(registry.isVerified(alice));
    }
}
