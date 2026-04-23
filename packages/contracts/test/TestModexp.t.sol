// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test, console2} from "forge-std/Test.sol";

contract TestModexp is Test {
    uint256 constant MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    function test_modexpWorks() public view {
        // Test invert(1) = 1
        uint256 v = 1;
        uint256 result;
        bool success;
        assembly {
            let free := mload(0x40)
            mstore(free, 0x20)
            mstore(add(free, 0x20), 0x20)
            mstore(add(free, 0x40), 0x20)
            mstore(add(free, 0x60), v)
            mstore(add(free, 0x80), sub(MODULUS, 2))
            mstore(add(free, 0xa0), MODULUS)
            success := staticcall(gas(), 0x05, free, 0xc0, 0x00, 0x20)
            result := mload(0x00)
        }
        console2.log("success:", success);
        console2.log("invert(1):", result);
        assertTrue(success, "modexp should succeed");
        assertEq(result, 1, "invert(1) should be 1");
        
        // Test invert(0) = 0 (not a field inverse but modexp won't fail)
        uint256 v0 = 0;
        assembly {
            let free := mload(0x40)
            mstore(free, 0x20)
            mstore(add(free, 0x20), 0x20)
            mstore(add(free, 0x40), 0x20)
            mstore(add(free, 0x60), v0)
            mstore(add(free, 0x80), sub(MODULUS, 2))
            mstore(add(free, 0xa0), MODULUS)
            success := staticcall(gas(), 0x05, free, 0xc0, 0x00, 0x20)
            result := mload(0x00)
        }
        console2.log("success invert(0):", success);
        console2.log("invert(0):", result);
        assertTrue(success, "modexp with 0 should succeed");
        assertEq(result, 0, "invert(0) should be 0");
    }
    
    function test_gasUsed() public view {
        // Estimate gas for 568 inversions
        uint256 gasStart = gasleft();
        uint256 v = 12345;
        uint256 result;
        bool success;
        for (uint256 i = 0; i < 568; i++) {
            assembly {
                let free := mload(0x40)
                mstore(free, 0x20)
                mstore(add(free, 0x20), 0x20)
                mstore(add(free, 0x40), 0x20)
                mstore(add(free, 0x60), v)
                mstore(add(free, 0x80), sub(MODULUS, 2))
                mstore(add(free, 0xa0), MODULUS)
                success := staticcall(gas(), 0x05, free, 0xc0, 0x00, 0x20)
                result := mload(0x00)
            }
        }
        uint256 gasUsed = gasStart - gasleft();
        console2.log("Gas for 568 inversions:", gasUsed);
        console2.log("Last success:", success);
        console2.log("Last result:", result);
    }
}
