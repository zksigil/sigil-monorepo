// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VerificationRegistry} from "../src/VerificationRegistry.sol";
import {IVerificationRegistry} from "../src/interfaces/IVerificationRegistry.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";

contract VerificationRegistryTest is Test {
    VerificationRegistry public registry;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    bytes32 constant NULLIFIER_A = keccak256("passport_nullifier_A");
    bytes32 constant NULLIFIER_B = keccak256("passport_nullifier_B");
    uint256 constant COMMITMENT_A = 12345678901234567890;
    uint256 constant COMMITMENT_B = 98765432109876543210;
    bytes constant DUMMY_PROOF = hex"deadbeef";

    // =========================================================================
    // Setup
    // =========================================================================

    function setUp() public {
        registry = new VerificationRegistry(owner);
    }

    // =========================================================================
    // Registration
    // =========================================================================

    function test_RegisterWallet_Success() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        assertTrue(registry.isVerified(alice));
        assertEq(registry.getGroupSize(), 1);

        IVerificationRegistry.WalletInfo memory info = registry.getWalletInfo(alice);
        assertTrue(info.verified);
        assertFalse(info.previouslyUnregistered);
        assertEq(info.groupSizeAtVerification, 1);
        assertEq(info.identityCommitment, COMMITMENT_A);
        assertEq(info.verifiedAt, block.timestamp);
    }

    function test_RegisterWallet_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit IVerificationRegistry.WalletRegistered(alice, NULLIFIER_A, 1, block.timestamp);

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
    }

    function test_Register_Reverts_WhenAlreadyRegistered() public {
        vm.startPrank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        vm.expectRevert(VerificationRegistry.VerificationRegistry__AlreadyRegistered.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
        vm.stopPrank();
    }

    function test_Register_Reverts_WhenZeroCommitment() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__ZeroIdentityCommitment.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A, 0);
    }

    function test_Register_Reverts_WhenPaused() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
    }

    // =========================================================================
    // Nullifier stats
    // =========================================================================

    function test_SameNullifier_MultipleWallets() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        vm.prank(bob);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_B);

        assertEq(registry.getGroupSize(), 2);

        IVerificationRegistry.NullifierInfo memory nullInfo = registry.getNullifierInfo(NULLIFIER_A);
        assertEq(nullInfo.currentCount, 2);
        assertEq(nullInfo.peakCount, 2);
    }

    function test_NullifierPeakCount_NeverDecreases() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        vm.prank(bob);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_B);

        vm.prank(alice);
        registry.unregister();

        IVerificationRegistry.NullifierInfo memory nullInfo = registry.getNullifierInfo(NULLIFIER_A);
        assertEq(nullInfo.currentCount, 1);
        assertEq(nullInfo.peakCount, 2); // peak preserved
    }

    // =========================================================================
    // Unregistration
    // =========================================================================

    function test_Unregister_Success() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        vm.prank(alice);
        registry.unregister();

        assertFalse(registry.isVerified(alice));
        assertEq(registry.getGroupSize(), 0);

        IVerificationRegistry.WalletInfo memory info = registry.getWalletInfo(alice);
        assertFalse(info.verified);
        assertTrue(info.previouslyUnregistered);
    }

    function test_Unregister_EmitsEvent() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        vm.expectEmit(true, true, false, true);
        emit IVerificationRegistry.WalletUnregistered(alice, NULLIFIER_A, 0, block.timestamp);

        vm.prank(alice);
        registry.unregister();
    }

    function test_Unregister_Reverts_WhenNotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__NotRegistered.selector);
        registry.unregister();
    }

    function test_ReRegister_AfterUnregister() public {
        vm.startPrank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
        registry.unregister();
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
        vm.stopPrank();

        assertTrue(registry.isVerified(alice));
        IVerificationRegistry.WalletInfo memory info = registry.getWalletInfo(alice);
        assertTrue(info.previouslyUnregistered); // history preserved
    }

    // =========================================================================
    // Owner functions
    // =========================================================================

    function test_SetZkVerifier() public {
        address verifier = makeAddr("zkverifier");
        vm.prank(owner);
        registry.setZkVerifier(verifier);
        assertEq(registry.getZkVerifier(), verifier);
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

    function test_Pause_Unregister_AlsoReverts() public {
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.unregister();
    }

    // =========================================================================
    // Fuzz tests
    // =========================================================================

    function testFuzz_Register_WithVariousCommitments(uint256 commitment) public {
        vm.assume(commitment != 0);
        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, commitment);
        assertTrue(registry.isVerified(alice));
    }

    function testFuzz_GroupSize_Monotone(uint8 walletCount) public {
        vm.assume(walletCount > 0 && walletCount <= 50);

        for (uint256 i = 0; i < walletCount; i++) {
            address wallet = address(uint160(i + 1000));
            vm.prank(wallet);
            registry.register(DUMMY_PROOF, bytes32(i), uint256(i + 1));
        }

        assertEq(registry.getGroupSize(), walletCount);
    }

    // =========================================================================
    // Groth16 Verifier Integration
    // =========================================================================

    function test_Register_WithVerifier_ValidProof() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();
        // verifier returns true by default

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);

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
                "groth16 verification failed"
            )
        );
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
    }

    function test_Register_WithVerifier_Revert_GivesVerifierCallFailed() public {
        MockGroth16Verifier verifier = new MockGroth16Verifier();
        verifier.setShouldRevert(true);

        vm.prank(owner);
        registry.setZkVerifier(address(verifier));

        vm.prank(alice);
        vm.expectRevert(VerificationRegistry.VerificationRegistry__VerifierCallFailed.selector);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
    }

    function test_Register_WithoutVerifier_StillWorks() public {
        // Verify Phase 1 behavior: no verifier set, registration succeeds
        assertEq(registry.getZkVerifier(), address(0));

        vm.prank(alice);
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
        assertTrue(registry.isVerified(alice));
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

    function test_Register_WithVerifier_EOA_Address_Reverts() public {
        // Setting an EOA (non-contract) as verifier should revert on register
        address fakeVerifier = makeAddr("not_a_contract");

        vm.prank(owner);
        registry.setZkVerifier(fakeVerifier);

        vm.prank(alice);
        vm.expectRevert();
        registry.register(DUMMY_PROOF, NULLIFIER_A, COMMITMENT_A);
    }
}
