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

    uint48 public constant PASSPORT_EXPIRY = type(uint48).max;
    bytes public constant PROOF = hex"";

    bytes32 public constant CSCA_MERKLE_ROOT = 0x06db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de;

    // Stable per-passport nullifiers (in prod: Poseidon2(passportSecret, 1)).
    bytes32 public constant NULL_A = keccak256("passport_A_stable_nullifier");
    bytes32 public constant NULL_B = keccak256("passport_B_stable_nullifier");

    // Epoch nullifiers (in prod: hash(s, "epoch", day)). A passport on a given day
    // produces a single epoch nullifier; rate limiting counts registrations per epoch.
    bytes32 public constant EPOCH_A_DAY0 = keccak256("epoch_A_day0");
    bytes32 public constant EPOCH_A_DAY1 = keccak256("epoch_A_day1");
    bytes32 public constant EPOCH_B_DAY0 = keccak256("epoch_B_day0");

    function setUp() public {
        config = new ProtocolConfig(governor);
        verifier = new MockProofVerifier();
        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, governor);
        registry = new VerificationRegistry(governor, config, verifier, address(cscaTree));
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _register(address wallet, bytes32 nullifier, bytes32 epochNullifier) internal {
        vm.prank(wallet);
        registry.register(nullifier, epochNullifier, PASSPORT_EXPIRY, PROOF);
    }

    function _hashed(address wallet) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(wallet));
    }

    // =========================================================================
    // register — basic
    // =========================================================================

    function test_Register_Success() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        assertTrue(registry.isVerified(alice));
        assertEq(registry.nullifierOf(alice), NULL_A);
    }

    function test_Register_EmitsWalletVerified() public {
        vm.expectEmit(true, false, false, false);
        emit IVerificationRegistry.WalletVerified(alice);
        _register(alice, NULL_A, EPOCH_A_DAY0);
    }

    function test_Register_Reverts_AlreadyRegistered() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__AlreadyRegistered.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    function test_Register_Reverts_PassportExpired() public {
        uint48 expiredPassport = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, expiredPassport, PROOF);
    }

    function test_Register_Reverts_InvalidProof() public {
        verifier.setReject(true);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__InvalidProof.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    function test_Register_Reverts_WhenPaused() public {
        vm.prank(governor);
        registry.pause();
        vm.prank(alice);
        vm.expectRevert();
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // register — multi-wallet per passport (the core single-tier behavior)
    // =========================================================================

    function test_Register_MultipleWallets_SamePassport_ShareNullifier() public {
        // Both wallets register with the same passport nullifier.
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(registry.nullifierOf(alice), NULL_A);
        assertEq(registry.nullifierOf(bob), NULL_A);
    }

    function test_Register_MultipleWallets_DifferentPassports_DifferentNullifiers() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_B, EPOCH_B_DAY0);

        assertEq(registry.nullifierOf(alice), NULL_A);
        assertEq(registry.nullifierOf(bob), NULL_B);
    }

    function test_GetWallets_ReturnsAllRegisteredUnderNullifier() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);
        _register(carol, NULL_A, EPOCH_A_DAY0);

        address[] memory wallets = registry.getWallets(NULL_A);
        assertEq(wallets.length, 3);
        assertEq(wallets[0], alice);
        assertEq(wallets[1], bob);
        assertEq(wallets[2], carol);
    }

    function test_GetWallets_EmptyForUnusedNullifier() public view {
        address[] memory wallets = registry.getWallets(NULL_B);
        assertEq(wallets.length, 0);
    }

    // =========================================================================
    // register — rate limiting (epoch nullifier)
    // =========================================================================

    function test_RateLimit_BlocksEleventhRegistration() public {
        for (uint256 i = 0; i < 10; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        }

        vm.prank(attacker);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__RateLimitExceeded.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    function test_RateLimit_DifferentEpochAllowsMore() public {
        for (uint256 i = 0; i < 10; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        }

        // New day → new epoch nullifier → fresh count
        _register(alice, NULL_A, EPOCH_A_DAY1);
        assertTrue(registry.isVerified(alice));
    }

    function test_RateLimit_GovernorCanReduce() public {
        vm.prank(governor);
        config.setMaxDailyRegistrations(2);

        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);

        vm.prank(carol);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__RateLimitExceeded.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // register — expiry
    // =========================================================================

    function test_Register_ExpiresAfterTTL() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        assertTrue(registry.isVerified(alice));

        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_Register_ExpiresAtPassportExpiry_WhenEarlierThanTTL() public {
        uint48 rawExpiry = uint48(block.timestamp + 30 days);
        uint48 roundedExpiry = ((rawExpiry + 90 days - 1) / 90 days) * 90 days;

        vm.prank(alice);
        registry.register(NULL_A, EPOCH_A_DAY0, rawExpiry, PROOF);
        assertTrue(registry.isVerified(alice));

        vm.warp(uint256(roundedExpiry) - 1);
        assertTrue(registry.isVerified(alice));

        vm.warp(uint256(roundedExpiry) + 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_Register_IsVerified_ReturnsFalseLazily() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isVerified(alice));

        // nullifierOf still returns the nullifier — only liveness is gated by isVerified.
        assertEq(registry.nullifierOf(alice), NULL_A);

        // Re-register with a different epoch (new day) succeeds.
        _register(alice, NULL_A, EPOCH_A_DAY1);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // register — re-registration logic (wallet array deduplication)
    // =========================================================================

    function test_Register_AfterExpiry_SameNullifier_DoesNotDuplicateInArray() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + config.registrationTTL() + 1);
        // No unregister — the array still contains alice.
        _register(alice, NULL_A, EPOCH_A_DAY1);

        address[] memory wallets = registry.getWallets(NULL_A);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], alice);
    }

    function test_Register_AfterExpiry_DifferentNullifier_MovesArrayEntry() public {
        // Alice registers with passport A. Lapses. Replaces passport — registers with passport B.
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + config.registrationTTL() + 1);

        vm.prank(alice);
        registry.register(NULL_B, EPOCH_B_DAY0, PASSPORT_EXPIRY, PROOF);

        // Old array empty, new array contains alice, nullifierByWallet updated.
        assertEq(registry.getWallets(NULL_A).length, 0);
        address[] memory walletsB = registry.getWallets(NULL_B);
        assertEq(walletsB.length, 1);
        assertEq(walletsB[0], alice);
        assertEq(registry.nullifierOf(alice), NULL_B);
    }

    // =========================================================================
    // renew
    // =========================================================================

    function test_Renew_ExtendsExpiry() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + config.registrationTTL() - 1 days);

        vm.prank(alice);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);

        vm.warp(block.timestamp + config.registrationTTL() - 1);
        assertTrue(registry.isVerified(alice));
    }

    function test_Renew_PreservesRegisteredAt() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        uint48 originalRegisteredAt = registry.getRegisteredAt(alice);

        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);

        assertEq(registry.getRegisteredAt(alice), originalRegisteredAt);
    }

    function test_Renew_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
    }

    function test_Renew_Reverts_PassportExpired() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        uint48 expired = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportExpired.selector);
        registry.renew(NULL_A, EPOCH_A_DAY1, expired, PROOF);
    }

    function test_Renew_Reverts_NullifierMismatch() public {
        // Renew must use the same nullifier the wallet was registered with.
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NullifierMismatch.selector);
        registry.renew(NULL_B, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
    }

    function test_Renew_DoesNotConsumeRateLimit() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);

        // Fill the daily rate limit with 9 other wallets (total 10 with alice).
        for (uint256 i = 0; i < 9; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        }

        // Alice can still renew — renewal is exempt from rate limiting.
        vm.prank(alice);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isVerified(alice));
    }

    function test_Renew_AllowsRenewAfterExpiry_SameNullifier() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + config.registrationTTL() + 1);
        assertFalse(registry.isVerified(alice));

        // Even after lapse, renewing with the same nullifier extends the registration.
        vm.prank(alice);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // unregister
    // =========================================================================

    function test_Unregister_Success() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        assertTrue(registry.isVerified(alice));

        vm.prank(alice);
        registry.unregister();

        assertFalse(registry.isVerified(alice));
        assertEq(registry.nullifierOf(alice), bytes32(0));
    }

    function test_Unregister_NoEventEmitted() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.recordLogs();

        vm.prank(alice);
        registry.unregister();

        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_Unregister_AllowsImmediateReregister_NoCooldown() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);

        vm.prank(alice);
        registry.unregister();

        // Re-register immediately (a different epoch nullifier — same passport, next bucket
        // of the day's count if it hadn't been used yet).
        _register(alice, NULL_A, EPOCH_A_DAY1);
        assertTrue(registry.isVerified(alice));
    }

    function test_Unregister_RemovesFromWalletArray() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);
        _register(carol, NULL_A, EPOCH_A_DAY0);

        // Bob unregisters — swap-and-pop with carol (the last entry).
        vm.prank(bob);
        registry.unregister();

        address[] memory wallets = registry.getWallets(NULL_A);
        assertEq(wallets.length, 2);
        // alice remains at index 0; carol moved to index 1.
        assertEq(wallets[0], alice);
        assertEq(wallets[1], carol);
    }

    function test_Unregister_RemovesLastEntry_NoSwap() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);

        // Bob is the last entry — pop without swap.
        vm.prank(bob);
        registry.unregister();

        address[] memory wallets = registry.getWallets(NULL_A);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], alice);
    }

    function test_Unregister_FollowedByOtherUnregister_ArrayConsistent() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);
        _register(carol, NULL_A, EPOCH_A_DAY0);

        vm.prank(bob);
        registry.unregister();

        vm.prank(carol);
        registry.unregister();

        address[] memory wallets = registry.getWallets(NULL_A);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], alice);
    }

    function test_Unregister_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregister();
    }

    // =========================================================================
    // nullifierOf — public sybil identifier
    // =========================================================================

    function test_NullifierOf_ZeroBeforeRegister() public view {
        assertEq(registry.nullifierOf(alice), bytes32(0));
    }

    function test_NullifierOf_SetAfterRegister() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        assertEq(registry.nullifierOf(alice), NULL_A);
    }

    function test_NullifierOf_ClearedOnUnregister() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.prank(alice);
        registry.unregister();

        assertEq(registry.nullifierOf(alice), bytes32(0));
    }

    function test_NullifierOf_PersistsAfterExpiry() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + config.registrationTTL() + 1);

        // Expiry doesn't auto-clear the nullifier mapping — protocols can still see who
        // this wallet *was* registered as. Pair with isVerified for liveness.
        assertEq(registry.nullifierOf(alice), NULL_A);
        assertFalse(registry.isVerified(alice));
    }

    // =========================================================================
    // Successor / migration
    // =========================================================================

    function test_Successor_AllReadFunctionsDelegate() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);

        VerificationRegistry successor = new VerificationRegistry(governor, config, verifier, address(cscaTree));
        vm.prank(bob);
        successor.register(NULL_B, EPOCH_B_DAY0, PASSPORT_EXPIRY, PROOF);

        vm.prank(governor);
        registry.setSuccessor(address(successor));

        // Old registry now reflects successor state.
        assertFalse(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(registry.nullifierOf(bob), NULL_B);
        assertEq(registry.getWallets(NULL_B).length, 1);
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

        _register(alice, NULL_A, EPOCH_A_DAY0);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_Register_RandomNullifierAndEpoch(bytes32 nullifier, bytes32 epochNullifier) public {
        vm.prank(alice);
        registry.register(nullifier, epochNullifier, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isVerified(alice));
        assertEq(registry.nullifierOf(alice), nullifier);
    }

    function testFuzz_Expiry_NeverActiveAfterPassportExpiry(uint48 passportExpiry) public {
        passportExpiry = uint48(bound(passportExpiry, block.timestamp + 1, block.timestamp + 10 * 365 days));
        uint48 roundedExpiry = passportExpiry <= type(uint48).max - (90 days - 1)
            ? ((passportExpiry + 90 days - 1) / 90 days) * 90 days
            : passportExpiry;

        vm.prank(alice);
        registry.register(NULL_A, EPOCH_A_DAY0, passportExpiry, PROOF);

        vm.warp(uint256(roundedExpiry) + 1);
        assertFalse(registry.isVerified(alice));
    }
}
