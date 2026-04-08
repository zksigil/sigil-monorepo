// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CSCAMerkleTree} from "../src/CSCAMerkleTree.sol";

contract CSCAMerkleTreeTest is Test {
    CSCAMerkleTree public tree;
    bytes32 public constant INITIAL_ROOT = 0x06db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de;
    bytes32 public constant NEW_ROOT = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;

    address public owner = makeAddr("owner");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        vm.prank(owner);
        tree = new CSCAMerkleTree(INITIAL_ROOT, owner);
    }

    // =========================================================================
    // Defaults
    // =========================================================================

    function test_Defaults() public view {
        assertEq(tree.getRoot(), INITIAL_ROOT);
        assertEq(tree.owner(), owner);
        assertGt(tree.lastUpdatedAt(), 0);
    }

    // =========================================================================
    // setRoot — owner
    // =========================================================================

    function test_SetRoot_Success() public {
        vm.prank(owner);
        tree.setRoot(NEW_ROOT);
        assertEq(tree.getRoot(), NEW_ROOT);
    }

    function test_SetRoot_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit CSCAMerkleTree.MerkleRootUpdated(INITIAL_ROOT, NEW_ROOT, block.timestamp);

        vm.prank(owner);
        tree.setRoot(NEW_ROOT);
    }

    function test_SetRoot_UpdatesTimestamp() public {
        uint256 oldTimestamp = tree.lastUpdatedAt();
        vm.warp(block.timestamp + 1 days);

        vm.prank(owner);
        tree.setRoot(NEW_ROOT);

        assertEq(tree.lastUpdatedAt(), block.timestamp);
        assertGt(tree.lastUpdatedAt(), oldTimestamp);
    }

    // =========================================================================
    // setRoot — non-owner reverts
    // =========================================================================

    function test_SetRoot_Reverts_WhenNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        tree.setRoot(NEW_ROOT);
    }

    // =========================================================================
    // Ownership transfer (Ownable2Step)
    // =========================================================================

    function test_TransferOwnership_TwoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        tree.transferOwnership(newOwner);

        // Owner is still the old one until accepted
        assertEq(tree.owner(), owner);
        assertEq(tree.pendingOwner(), newOwner);

        // Stranger cannot accept
        vm.prank(stranger);
        vm.expectRevert();
        tree.acceptOwnership();

        // New owner accepts
        vm.prank(newOwner);
        tree.acceptOwnership();

        assertEq(tree.owner(), newOwner);
        assertEq(tree.pendingOwner(), address(0));
    }

    function test_TransferOwnership_OwnerCanStillSetRoot() public {
        vm.prank(owner);
        tree.setRoot(NEW_ROOT);
        assertEq(tree.getRoot(), NEW_ROOT);
    }
}
