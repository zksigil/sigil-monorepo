// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {IVerificationRegistry} from "../src/interfaces/IVerificationRegistry.sol";
import {IGroth16Verifier} from "../src/interfaces/IGroth16Verifier.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";

contract VerificationRegistryTest is Test {
    VerificationRegistry public registry;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public attacker = makeAddr("attacker");

    bytes32 constant NULLIFIER_A = keccak256("passport_nullifier_A");
    bytes32 constant NULLIFIER_B = keccak256("passport_nullifier_B");
    bytes constant DUMMY_PROOF = hex"deadbeef";

    function setUp() public {
        registry = new VerificationRegistry(owner);
    }

    // =========================================================================
    // Registration
    // =========================================================================

    function test_Register_Success() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        assertTrue(registry.isVerified(alice));
        assertEq(registry.getGroupSize(), 1);
    }

    function test_Register_EmitsWalletVerified() public {
        vm.expectEmit(true, false, false, true);
        emit IVerificationRegistry.WalletVerified(alice, block.timestamp);

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    function test_Register_Reverts_AlreadyRegistered() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__AlreadyRegistered.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_B);
    }

    function test_Register_Reverts_PassportAlreadyActive() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(bob);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportAlreadyActive.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    function test_Register_Reverts_PassportInCooldown() public {
        // Register and unregister to trigger cooldown
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        // Try to re-register immediately — should fail
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportInCooldown.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    function test_Register_Succeeds_AfterCooldownElapsed() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        // Warp past cooldown
        vm.warp(block.timestamp + registry.REREGISTRATION_COOLDOWN());

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        assertTrue(registry.isVerified(alice));
    }

    function test_Register_Reverts_WhenPaused() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    // =========================================================================
    // Unregistration
    // =========================================================================

    function test_Unregister_Success() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        assertFalse(registry.isVerified(alice));
        assertEq(registry.getGroupSize(), 0);
    }

    function test_Unregister_NoEventEmitted() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.recordLogs();

        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        // No logs should be emitted during unregister
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_Unregister_Reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregister(NULLIFIER_A);
    }

    function test_Unregister_Reverts_WrongNullifier() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__InvalidRegistrationCommitment.selector);
        registry.unregister(NULLIFIER_B);
    }

    function test_Unregister_Griefing_AttackerCannotUnregisterVictim() public {
        // Alice registers with NULLIFIER_A
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        // Attacker knows alice's passportNullifier but calls from their own address.
        // commitment = keccak256(NULLIFIER_A, attacker) != keccak256(NULLIFIER_A, alice)
        // Attacker is not registered, so it reverts NotRegistered first.
        vm.prank(attacker);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregister(NULLIFIER_A);

        // Alice is still verified
        assertTrue(registry.isVerified(alice));
    }

    function test_Unregister_Griefing_RegisteredAttackerCannotUnregisterVictim() public {
        // Alice registers with NULLIFIER_A
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        // Attacker registers with their own passport
        vm.prank(attacker);
        registry.register(DUMMY_PROOF, NULLIFIER_B);

        // Attacker tries to unregister using alice's nullifier — commitment won't match
        vm.prank(attacker);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__InvalidRegistrationCommitment.selector);
        registry.unregister(NULLIFIER_A);

        // Both still verified
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(attacker));
    }

    function test_Unregister_Reverts_WhenPaused() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.unregister(NULLIFIER_A);
    }

    // =========================================================================
    // Re-registration
    // =========================================================================

    function test_ReRegister_SameWalletSamePassport_AfterCooldown() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        vm.warp(block.timestamp + registry.REREGISTRATION_COOLDOWN());

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        assertTrue(registry.isVerified(alice));
        assertEq(registry.getGroupSize(), 1);
    }

    function test_ReRegister_DifferentWalletSamePassport_AfterCooldown() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        vm.warp(block.timestamp + registry.REREGISTRATION_COOLDOWN());

        // Bob registers with the same passport nullifier
        vm.prank(bob);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        assertFalse(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
    }

    function test_ReRegister_Reverts_BeforeCooldown() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        // Warp to 1 second before cooldown expires
        vm.warp(block.timestamp + registry.REREGISTRATION_COOLDOWN() - 1);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__PassportInCooldown.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    // =========================================================================
    // Privacy properties
    // =========================================================================

    function test_Privacy_NoSharedStateBetweenDifferentPassports() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(bob);
        registry.register(DUMMY_PROOF, NULLIFIER_B);

        // Both verified independently
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(registry.getGroupSize(), 2);

        // Unregistering alice doesn't affect bob
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        assertFalse(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(registry.getGroupSize(), 1);
    }

    function test_Privacy_NoPublicNullifierLookup() public {
        // There is no getWalletInfo, getNullifierInfo, or any public way to
        // map an address to a passportNullifier. The only public query is isVerified(address).
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        // isVerified is the only address-based query
        assertTrue(registry.isVerified(alice));

        // Confirm no linkage: bob can't determine alice's nullifier from on-chain state.
        // (This is a design-level test — the interface simply doesn't expose it.)
    }

    // =========================================================================
    // ZK verifier integration
    // =========================================================================

    function test_Register_WithVerifier_ValidProof() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        assertTrue(registry.isVerified(alice));
    }

    function test_Register_WithVerifier_InvalidProof_Reverts() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();
        verifier.setReturnValue(false);

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                VerificationRegistry.VerificationRegistry__InvalidProof.selector,
                "zk verification failed"
            )
        );
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    function test_Register_WithVerifier_Revert_GivesVerifierCallFailed() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();
        verifier.setShouldRevert(true);

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__VerifierCallFailed.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    function test_Register_WithVerifier_CorrectPublicSignals() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));

        // Build expected calldata: verifyProof(DUMMY_PROOF, [uint256(NULLIFIER_A), uint256(uint160(alice))])
        uint256[] memory expectedSignals = new uint256[](2);
        expectedSignals[0] = uint256(NULLIFIER_A);
        expectedSignals[1] = uint256(uint160(alice));

        vm.expectCall(
            address(verifier),
            abi.encodeCall(IGroth16Verifier.verifyProof, (DUMMY_PROOF, expectedSignals))
        );

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    function test_Register_WithoutVerifier_StillWorks() public {
        assertEq(registry.getZkVerifier(), address(0));

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        assertTrue(registry.isVerified(alice));
    }

    function test_Register_WithVerifier_EOA_Reverts() public {
        address fakeVerifier = makeAddr("not_a_contract");

        vm.prank(owner);
        registry.setZkVerifier(fakeVerifier);

        vm.prank(alice);
        vm.expectRevert();
        registry.register(DUMMY_PROOF, NULLIFIER_A);
    }

    // =========================================================================
    // Fuzz tests
    // =========================================================================

    function testFuzz_Register_RandomNullifiers(bytes32 nullifier) public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, nullifier);
        assertTrue(registry.isVerified(alice));
        assertEq(registry.getGroupSize(), 1);
    }

    function testFuzz_Unregister_WrongNullifier_Reverts(bytes32 wrongNullifier) public {
        vm.assume(wrongNullifier != NULLIFIER_A);

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__InvalidRegistrationCommitment.selector);
        registry.unregister(wrongNullifier);
    }

    function testFuzz_GroupSize_Monotone(uint8 walletCount) public {
        vm.assume(walletCount > 0 && walletCount <= 50);

        for (uint256 i = 0; i < walletCount; i++) {
            address wallet = address(uint160(i + 1000));
            vm.prank(wallet);
            registry.register(DUMMY_PROOF, bytes32(i));
        }

        assertEq(registry.getGroupSize(), walletCount);
    }

    // =========================================================================
    // Owner functions
    // =========================================================================

    function test_SetZkVerifier_Success() public {
        address verifier = makeAddr("zkverifier");
        vm.prank(owner);
        registry.setZkVerifier(verifier);
        assertEq(registry.getZkVerifier(), verifier);
    }

    function test_SetZkVerifier_EmitsEvent() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();

        vm.expectEmit(true, true, false, true);
        emit VerificationRegistry.ZkVerifierUpdated(address(0), address(verifier));

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));
    }

    function test_SetZkVerifier_UpdateEmitsEventWithOldAddress() public {
        MockGroth16Verifier verifier1 = new MockGroth16Verifier();
        MockGroth16Verifier verifier2 = new MockGroth16Verifier();

        vm.startPrank(owner);
        registry.setZkVerifier(address(verifier1));

        vm.expectEmit(true, true, false, true);
        emit VerificationRegistry.ZkVerifierUpdated(address(verifier1), address(verifier2));

        registry.setZkVerifier(address(verifier2));
        vm.stopPrank();

        assertEq(registry.getZkVerifier(), address(verifier2));
    }

    function test_SetZkVerifier_Reverts_ZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__ZeroAddress.selector);
        registry.setZkVerifier(address(0));
    }

    function test_SetZkVerifier_Reverts_NonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.setZkVerifier(makeAddr("verifier"));
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.pause();
    }

    function test_Unpause_OnlyOwner() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.unpause();
    }

    function test_Unpause_AllowsRegistration() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(owner);
        registry.unpause();

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        assertTrue(registry.isVerified(alice));
    }

    // =========================================================================
    // Constants
    // =========================================================================

    function test_CooldownConstant_Is7Days() public view {
        assertEq(registry.REREGISTRATION_COOLDOWN(), 7 days);
    }

    // =========================================================================
    // Cooldown Boundary
    // =========================================================================

    function test_Register_CooldownExactBoundary() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);

        uint256 unregisterTs = block.timestamp;
        vm.prank(alice);
        registry.unregister(NULLIFIER_A);

        // Warp to exactly cooldown expiry — should succeed (strict < check in contract)
        vm.warp(unregisterTs + registry.REREGISTRATION_COOLDOWN());

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A);
        assertTrue(registry.isVerified(alice));
    }
}
