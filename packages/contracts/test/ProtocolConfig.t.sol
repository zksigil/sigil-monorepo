// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";

contract ProtocolConfigTest is Test {
    ProtocolConfig public config;
    address public governor = makeAddr("governor");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        config = new ProtocolConfig(governor);
    }

    // =========================================================================
    // Defaults
    // =========================================================================

    function test_Defaults() public view {
        assertEq(config.registrationTTL(), 180 days);
        assertEq(config.cooldownPeriod(), 7 days);
        assertEq(config.maxDailyRegistrations(), 10);
        assertEq(config.s_governor(), governor);
    }

    // =========================================================================
    // setRegistrationTTL
    // =========================================================================

    function test_SetRegistrationTTL_Success() public {
        vm.prank(governor);
        config.setRegistrationTTL(90 days);
        assertEq(config.registrationTTL(), 90 days);
    }

    function test_SetRegistrationTTL_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ProtocolConfig.RegistrationTTLUpdated(180 days, 90 days);

        vm.prank(governor);
        config.setRegistrationTTL(90 days);
    }

    function test_SetRegistrationTTL_Reverts_BelowMin() public {
        uint256 min = config.MIN_TTL();
        uint256 max = config.MAX_TTL();
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig.ProtocolConfig__OutOfBounds.selector, "registrationTTL", min, max));
        config.setRegistrationTTL(min - 1);
    }

    function test_SetRegistrationTTL_Reverts_AboveMax() public {
        uint256 min = config.MIN_TTL();
        uint256 max = config.MAX_TTL();
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig.ProtocolConfig__OutOfBounds.selector, "registrationTTL", min, max));
        config.setRegistrationTTL(max + 1);
    }

    function test_SetRegistrationTTL_AtBounds() public {
        vm.startPrank(governor);
        config.setRegistrationTTL(config.MIN_TTL());
        assertEq(config.registrationTTL(), config.MIN_TTL());

        config.setRegistrationTTL(config.MAX_TTL());
        assertEq(config.registrationTTL(), config.MAX_TTL());
        vm.stopPrank();
    }

    function test_SetRegistrationTTL_Reverts_NonGovernor() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig.ProtocolConfig__NotGovernor.selector);
        config.setRegistrationTTL(90 days);
    }

    // =========================================================================
    // setCooldownPeriod
    // =========================================================================

    function test_SetCooldownPeriod_Success() public {
        vm.prank(governor);
        config.setCooldownPeriod(14 days);
        assertEq(config.cooldownPeriod(), 14 days);
    }

    function test_SetCooldownPeriod_Reverts_BelowMin() public {
        uint256 min = config.MIN_COOLDOWN();
        uint256 max = config.MAX_COOLDOWN();
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig.ProtocolConfig__OutOfBounds.selector, "cooldownPeriod", min, max));
        config.setCooldownPeriod(min - 1);
    }

    function test_SetCooldownPeriod_Reverts_AboveMax() public {
        uint256 min = config.MIN_COOLDOWN();
        uint256 max = config.MAX_COOLDOWN();
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig.ProtocolConfig__OutOfBounds.selector, "cooldownPeriod", min, max));
        config.setCooldownPeriod(max + 1);
    }

    function test_SetCooldownPeriod_Reverts_NonGovernor() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig.ProtocolConfig__NotGovernor.selector);
        config.setCooldownPeriod(14 days);
    }

    // =========================================================================
    // setMaxDailyRegistrations
    // =========================================================================

    function test_SetMaxDailyRegistrations_Success() public {
        vm.prank(governor);
        config.setMaxDailyRegistrations(5);
        assertEq(config.maxDailyRegistrations(), 5);
    }

    function test_SetMaxDailyRegistrations_Reverts_Zero() public {
        uint256 min = uint256(config.MIN_DAILY_REGISTRATIONS());
        uint256 max = uint256(config.MAX_DAILY_REGISTRATIONS());
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig.ProtocolConfig__OutOfBounds.selector, "maxDailyRegistrations", min, max));
        config.setMaxDailyRegistrations(0);
    }

    function test_SetMaxDailyRegistrations_Reverts_AboveMax() public {
        uint256 min = uint256(config.MIN_DAILY_REGISTRATIONS());
        uint8 max = config.MAX_DAILY_REGISTRATIONS();
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig.ProtocolConfig__OutOfBounds.selector, "maxDailyRegistrations", min, uint256(max)));
        config.setMaxDailyRegistrations(max + 1);
    }

    function test_SetMaxDailyRegistrations_Reverts_NonGovernor() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig.ProtocolConfig__NotGovernor.selector);
        config.setMaxDailyRegistrations(5);
    }

    // =========================================================================
    // transferGovernance
    // =========================================================================

    function test_TransferGovernance_Success() public {
        address newGov = makeAddr("newGov");
        vm.prank(governor);
        config.transferGovernance(newGov);
        assertEq(config.s_governor(), newGov);
    }

    function test_TransferGovernance_EmitsEvent() public {
        address newGov = makeAddr("newGov");
        vm.expectEmit(true, true, false, false);
        emit ProtocolConfig.GovernanceTransferred(governor, newGov);

        vm.prank(governor);
        config.transferGovernance(newGov);
    }

    function test_TransferGovernance_NewGovCanUpdate() public {
        address newGov = makeAddr("newGov");
        vm.prank(governor);
        config.transferGovernance(newGov);

        vm.prank(newGov);
        config.setRegistrationTTL(60 days);
        assertEq(config.registrationTTL(), 60 days);
    }

    function test_TransferGovernance_OldGovCannotUpdate() public {
        address newGov = makeAddr("newGov");
        vm.prank(governor);
        config.transferGovernance(newGov);

        vm.prank(governor);
        vm.expectRevert(ProtocolConfig.ProtocolConfig__NotGovernor.selector);
        config.setRegistrationTTL(60 days);
    }

    function test_TransferGovernance_Reverts_ZeroAddress() public {
        vm.prank(governor);
        vm.expectRevert("ProtocolConfig: zero address");
        config.transferGovernance(address(0));
    }

    function test_TransferGovernance_Reverts_NonGovernor() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig.ProtocolConfig__NotGovernor.selector);
        config.transferGovernance(stranger);
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_SetRegistrationTTL_WithinBounds(uint256 ttl) public {
        ttl = bound(ttl, config.MIN_TTL(), config.MAX_TTL());
        vm.prank(governor);
        config.setRegistrationTTL(ttl);
        assertEq(config.registrationTTL(), ttl);
    }

    function testFuzz_SetCooldownPeriod_WithinBounds(uint256 cooldown) public {
        cooldown = bound(cooldown, config.MIN_COOLDOWN(), config.MAX_COOLDOWN());
        vm.prank(governor);
        config.setCooldownPeriod(cooldown);
        assertEq(config.cooldownPeriod(), cooldown);
    }
}
