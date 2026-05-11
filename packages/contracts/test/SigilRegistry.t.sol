// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SigilRegistry, IUltraHonkVerifier} from "../src/SigilRegistry.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";
import {ISigilRegistry} from "../src/interfaces/ISigilRegistry.sol";
import {MockUltraHonkVerifier} from "./mocks/MockUltraHonkVerifier.sol";

contract SigilRegistryTest is Test {
    SigilRegistry public registry;
    MockUltraHonkVerifier public verifier;
    CSCAMerkleTree public cscaTree;

    address public cscaOwner = makeAddr("cscaOwner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public attacker = makeAddr("attacker");

    uint48 public constant PASSPORT_EXPIRY = type(uint48).max;
    bytes public constant PROOF = hex"";

    uint256 public constant TTL = 180 days;
    uint8 public constant MAX_DAILY = 10;

    bytes32 public constant CSCA_MERKLE_ROOT = 0x06db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de;

    bytes32 public constant NULL_A = keccak256("passport_A_stable_nullifier");
    bytes32 public constant NULL_B = keccak256("passport_B_stable_nullifier");
    bytes32 public constant EPOCH_A_DAY0 = keccak256("epoch_A_day0");
    bytes32 public constant EPOCH_A_DAY1 = keccak256("epoch_A_day1");
    bytes32 public constant EPOCH_B_DAY0 = keccak256("epoch_B_day0");

    function setUp() public {
        verifier = new MockUltraHonkVerifier();
        cscaTree = new CSCAMerkleTree(CSCA_MERKLE_ROOT, cscaOwner);
        registry = new SigilRegistry(verifier, address(cscaTree), TTL, MAX_DAILY);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _register(address wallet, bytes32 nullifier, bytes32 epochNullifier) internal {
        vm.prank(wallet);
        registry.register(nullifier, epochNullifier, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // Constructor — bounds + zero-address checks
    // =========================================================================

    function test_Constructor_Reverts_ZeroVerifier() public {
        vm.expectRevert(SigilRegistry.SigilRegistry__ZeroAddress.selector);
        new SigilRegistry(IUltraHonkVerifier(address(0)), address(cscaTree), TTL, MAX_DAILY);
    }

    function test_Constructor_Reverts_ZeroCscaTree() public {
        vm.expectRevert(SigilRegistry.SigilRegistry__ZeroAddress.selector);
        new SigilRegistry(verifier, address(0), TTL, MAX_DAILY);
    }

    function test_Constructor_Reverts_TTLBelowMin() public {
        vm.expectRevert(SigilRegistry.SigilRegistry__InvalidConfig.selector);
        new SigilRegistry(verifier, address(cscaTree), 29 days, MAX_DAILY);
    }

    function test_Constructor_Reverts_TTLAboveMax() public {
        vm.expectRevert(SigilRegistry.SigilRegistry__InvalidConfig.selector);
        new SigilRegistry(verifier, address(cscaTree), 366 days, MAX_DAILY);
    }

    function test_Constructor_Reverts_MaxDailyZero() public {
        vm.expectRevert(SigilRegistry.SigilRegistry__InvalidConfig.selector);
        new SigilRegistry(verifier, address(cscaTree), TTL, 0);
    }

    function test_Constructor_Reverts_MaxDailyAboveMax() public {
        vm.expectRevert(SigilRegistry.SigilRegistry__InvalidConfig.selector);
        new SigilRegistry(verifier, address(cscaTree), TTL, 51);
    }

    function test_Constructor_StoresImmutables() public view {
        assertEq(address(registry.i_verifier()), address(verifier));
        assertEq(address(registry.i_cscaMerkleTree()), address(cscaTree));
        assertEq(registry.i_registrationTTL(), TTL);
        assertEq(registry.i_maxDailyRegistrations(), MAX_DAILY);
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
        emit ISigilRegistry.WalletVerified(alice);
        _register(alice, NULL_A, EPOCH_A_DAY0);
    }

    function test_Register_Reverts_AlreadyRegistered() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);

        vm.prank(alice);
        vm.expectRevert(SigilRegistry.SigilRegistry__AlreadyRegistered.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    function test_Register_Reverts_PassportExpired() public {
        uint48 expiredPassport = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(SigilRegistry.SigilRegistry__PassportExpired.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, expiredPassport, PROOF);
    }

    function test_Register_Reverts_InvalidProof() public {
        verifier.setReject(true);
        vm.prank(alice);
        vm.expectRevert(SigilRegistry.SigilRegistry__InvalidProof.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // register — multi-wallet per passport
    // =========================================================================

    function test_Register_MultipleWallets_SamePassport_ShareNullifier() public {
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
    // register — rate limiting
    // =========================================================================

    function test_RateLimit_BlocksEleventhRegistration() public {
        for (uint256 i = 0; i < 10; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        }

        vm.prank(attacker);
        vm.expectRevert(SigilRegistry.SigilRegistry__RateLimitExceeded.selector);
        registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    function test_RateLimit_DifferentEpochAllowsMore() public {
        for (uint256 i = 0; i < 10; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        }

        _register(alice, NULL_A, EPOCH_A_DAY1);
        assertTrue(registry.isVerified(alice));
    }

    /// @notice Bounds enforced at deploy: a registry deployed with a smaller cap behaves accordingly.
    function test_RateLimit_TighterCap_DeployedRegistry() public {
        SigilRegistry tight = new SigilRegistry(verifier, address(cscaTree), TTL, 2);

        vm.prank(alice);
        tight.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        vm.prank(bob);
        tight.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);

        vm.prank(carol);
        vm.expectRevert(SigilRegistry.SigilRegistry__RateLimitExceeded.selector);
        tight.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
    }

    // =========================================================================
    // register — expiry
    // =========================================================================

    function test_Register_ExpiresAfterTTL() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        assertTrue(registry.isVerified(alice));

        vm.warp(block.timestamp + TTL + 1);
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
        vm.warp(block.timestamp + TTL + 1);
        assertFalse(registry.isVerified(alice));

        // Nullifier persists past expiry — only liveness is gated by isVerified.
        assertEq(registry.nullifierOf(alice), NULL_A);

        _register(alice, NULL_A, EPOCH_A_DAY1);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // register — re-registration logic (wallet array deduplication)
    // =========================================================================

    function test_Register_AfterExpiry_SameNullifier_DoesNotDuplicateInArray() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + TTL + 1);
        _register(alice, NULL_A, EPOCH_A_DAY1);

        address[] memory wallets = registry.getWallets(NULL_A);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], alice);
    }

    function test_Register_AfterExpiry_DifferentNullifier_MovesArrayEntry() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + TTL + 1);

        vm.prank(alice);
        registry.register(NULL_B, EPOCH_B_DAY0, PASSPORT_EXPIRY, PROOF);

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
        vm.warp(block.timestamp + TTL - 1 days);

        vm.prank(alice);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);

        vm.warp(block.timestamp + TTL - 1);
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
        vm.expectRevert(SigilRegistry.SigilRegistry__NotRegistered.selector);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
    }

    function test_Renew_Reverts_PassportExpired() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        uint48 expired = uint48(block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(SigilRegistry.SigilRegistry__PassportExpired.selector);
        registry.renew(NULL_A, EPOCH_A_DAY1, expired, PROOF);
    }

    function test_Renew_Reverts_NullifierMismatch() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.prank(alice);
        vm.expectRevert(SigilRegistry.SigilRegistry__NullifierMismatch.selector);
        registry.renew(NULL_B, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
    }

    function test_Renew_DoesNotConsumeRateLimit() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);

        for (uint256 i = 0; i < 9; i++) {
            address wallet = address(uint160(1000 + i));
            vm.prank(wallet);
            registry.register(NULL_A, EPOCH_A_DAY0, PASSPORT_EXPIRY, PROOF);
        }

        vm.prank(alice);
        registry.renew(NULL_A, EPOCH_A_DAY1, PASSPORT_EXPIRY, PROOF);
        assertTrue(registry.isVerified(alice));
    }

    function test_Renew_AllowsRenewAfterExpiry_SameNullifier() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + TTL + 1);
        assertFalse(registry.isVerified(alice));

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
        assertEq(wallets[0], alice);
        assertEq(wallets[1], carol);
    }

    function test_Unregister_RemovesLastEntry_NoSwap() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        _register(bob, NULL_A, EPOCH_A_DAY0);

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
        vm.expectRevert(SigilRegistry.SigilRegistry__NotRegistered.selector);
        registry.unregister();
    }

    // =========================================================================
    // nullifierOf — public sybil identifier
    // =========================================================================

    function test_NullifierOf_ZeroBeforeRegister() public view {
        assertEq(registry.nullifierOf(alice), bytes32(0));
    }

    function test_NullifierOf_ClearedOnUnregister() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.prank(alice);
        registry.unregister();

        assertEq(registry.nullifierOf(alice), bytes32(0));
    }

    function test_NullifierOf_PersistsAfterExpiry() public {
        _register(alice, NULL_A, EPOCH_A_DAY0);
        vm.warp(block.timestamp + TTL + 1);

        assertEq(registry.nullifierOf(alice), NULL_A);
        assertFalse(registry.isVerified(alice));
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
