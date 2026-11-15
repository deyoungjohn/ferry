// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { Deploy } from "../script/Deploy.s.sol";
import { FerryHTLC } from "../src/FerryHTLC.sol";

contract DeployTest is Test {
    address internal constant CANONICAL_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function test_predict_returnsDeterministicAddressAndInitCodeHash() public {
        Deploy deploy = new Deploy();
        (address predicted, bytes32 initCodeHash) = deploy.predict();
        bytes32 expectedInitCodeHash = keccak256(type(FerryHTLC).creationCode);
        address expectedAddress =
            vm.computeCreate2Address(deploy.SALT(), expectedInitCodeHash, CANONICAL_FACTORY);

        assertEq(initCodeHash, expectedInitCodeHash);
        assertEq(predicted, expectedAddress);
        assertTrue(predicted != address(0));
    }

    function test_run_revertsWhenFactoryMissing() public {
        Deploy deploy = new Deploy();
        vm.etch(CANONICAL_FACTORY, "");

        vm.expectRevert("canonical CREATE2 factory missing");
        deploy.run();
    }

    function test_run_succeedsPredictionWhenFactoryHasCode() public {
        Deploy deploy = new Deploy();
        vm.etch(CANONICAL_FACTORY, hex"00");
        vm.setEnv("DEPLOYER_EVM_PRIVATE_KEY", "0");

        deploy.run();
    }
}
