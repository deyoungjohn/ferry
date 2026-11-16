// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { FerryHTLC } from "../src/FerryHTLC.sol";
import { MockUSDCWithPermit } from "./mocks/MockUSDCWithPermit.sol";
import { MockFeeOnTransferToken } from "./mocks/MockFeeOnTransferToken.sol";
import { MockRebasingToken } from "./mocks/MockRebasingToken.sol";

contract FerryHTLCHardeningTest is Test {
    FerryHTLC internal htlc;
    MockUSDCWithPermit internal usdc;
    MockFeeOnTransferToken internal feeToken;
    MockRebasingToken internal rebaseToken;

    uint256 internal constant OWNER_PK = 0xA11CE;
    address internal owner;
    address internal recipient = address(0xBEEF);
    uint256 internal initialChainId;

    function setUp() public {
        htlc = new FerryHTLC();
        usdc = new MockUSDCWithPermit();
        feeToken = new MockFeeOnTransferToken();
        rebaseToken = new MockRebasingToken();
        owner = vm.addr(OWNER_PK);
        initialChainId = block.chainid;
    }

    function testFuzz_claimAfterDeadlineStillValid(
        bytes32 secret,
        uint256 amount,
        uint64 duration,
        uint64 delayAfterDeadline
    ) public {
        amount = bound(amount, 1, 1_000_000e6);
        duration = uint64(bound(duration, 1, 30 days));
        delayAfterDeadline = uint64(bound(delayAfterDeadline, 0, 365 days));

        bytes32 hashLock = sha256(abi.encodePacked(secret));
        uint64 deadline = uint64(block.timestamp) + duration;

        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(htlc), amount);
        bytes32 id = htlc.lock(address(usdc), recipient, amount, hashLock, deadline);
        vm.stopPrank();

        vm.warp(uint256(deadline) + uint256(delayAfterDeadline));
        htlc.claim(id, secret);

        assertEq(usdc.balanceOf(recipient), amount);
        assertEq(usdc.balanceOf(address(htlc)), 0);
        (,,,,,, FerryHTLC.State state) = htlc.locks(id);
        assertEq(uint8(state), uint8(FerryHTLC.State.Claimed));
    }

    function testFuzz_refundOnlyAtOrAfterDeadline(
        bytes32 secret,
        uint256 amount,
        uint64 duration,
        uint64 earlyOffset
    ) public {
        amount = bound(amount, 1, 1_000_000e6);
        duration = uint64(bound(duration, 2, 30 days));
        earlyOffset = uint64(bound(earlyOffset, 1, duration - 1));

        bytes32 hashLock = sha256(abi.encodePacked(secret));
        uint64 deadline = uint64(vm.getBlockTimestamp()) + duration;

        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(htlc), amount);
        bytes32 id = htlc.lock(address(usdc), recipient, amount, hashLock, deadline);
        vm.stopPrank();

        vm.warp(uint256(deadline) - uint256(earlyOffset));
        vm.expectRevert(FerryHTLC.TooEarly.selector);
        htlc.refund(id);

        vm.warp(deadline);
        htlc.refund(id);
        assertEq(usdc.balanceOf(owner), amount);
    }

    function testFuzz_lockWithIntent_replayAndCrossChainReplayRejected(
        uint256 newChainId,
        uint256 amount,
        bytes32 secret
    ) public {
        newChainId = bound(newChainId, 1, type(uint64).max);
        vm.assume(newChainId != block.chainid);
        amount = bound(amount, 1, 1_000_000e6);

        bytes32 hashLock = sha256(abi.encodePacked(secret));
        uint64 deadline = uint64(block.timestamp) + 1 days;
        uint256 intentDeadline = block.timestamp + 1 hours;

        usdc.mint(owner, amount * 2);

        bytes32 structHash = keccak256(
            abi.encode(
                htlc.LOCK_INTENT_TYPEHASH(),
                address(usdc),
                recipient,
                amount,
                hashLock,
                deadline,
                intentDeadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", htlc.DOMAIN_SEPARATOR(), structHash));
        (uint8 iv, bytes32 ir, bytes32 is_) = vm.sign(OWNER_PK, digest);
        bytes memory intentSig = abi.encodePacked(ir, is_, iv);

        uint256 nonce = usdc.nonces(owner);
        bytes32 permitStruct = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                owner,
                address(htlc),
                amount,
                nonce,
                intentDeadline
            )
        );
        bytes32 permitDigest =
            keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), permitStruct));
        (uint8 pv, bytes32 pr, bytes32 ps) = vm.sign(OWNER_PK, permitDigest);

        // 1. Cross-chain replay on a forked chainId must revert with InvalidIntentSignature.
        vm.chainId(newChainId);
        vm.expectRevert(FerryHTLC.InvalidIntentSignature.selector);
        htlc.lockWithIntent(
            owner,
            address(usdc),
            recipient,
            amount,
            hashLock,
            deadline,
            intentDeadline,
            intentSig,
            intentDeadline,
            pv,
            pr,
            ps
        );

        // 2. Execute legitimately on the original chainId.
        vm.chainId(initialChainId);
        htlc.lockWithIntent(
            owner,
            address(usdc),
            recipient,
            amount,
            hashLock,
            deadline,
            intentDeadline,
            intentSig,
            intentDeadline,
            pv,
            pr,
            ps
        );

        // 3. Same-chain replay must revert with AlreadyExists.
        vm.expectRevert(FerryHTLC.AlreadyExists.selector);
        htlc.lockWithIntent(
            owner,
            address(usdc),
            recipient,
            amount,
            hashLock,
            deadline,
            intentDeadline,
            intentSig,
            intentDeadline,
            pv,
            pr,
            ps
        );
    }

    function test_feeOnTransferToken_isNotRejectedOnChainAndCausesShortfall() public {
        uint256 amount = 10_000;
        bytes32 s1 = keccak256("fee-1");
        bytes32 s2 = keccak256("fee-2");
        uint64 deadline = uint64(block.timestamp) + 1 hours;

        feeToken.mint(owner, amount * 2);
        vm.startPrank(owner);
        feeToken.approve(address(htlc), amount * 2);
        bytes32 id1 =
            htlc.lock(address(feeToken), recipient, amount, sha256(abi.encodePacked(s1)), deadline);
        bytes32 id2 =
            htlc.lock(address(feeToken), recipient, amount, sha256(abi.encodePacked(s2)), deadline);
        vm.stopPrank();

        // Contract recorded 10_000 + 10_000 = 20_000, but only received 9_900 + 9_900 = 19_800.
        assertEq(feeToken.balanceOf(address(htlc)), 19_800);

        // Claiming lock 1 succeeds (pulls 10_000 from contract, leaving 9_800).
        htlc.claim(id1, s1);
        assertEq(feeToken.balanceOf(address(htlc)), 9_800);

        // Claiming lock 2 reverts because 9_800 < 10_000; fee-on-transfer tokens must be excluded off-chain.
        vm.expectRevert();
        htlc.claim(id2, s2);
    }

    function test_rebasingToken_downwardRebaseCausesShortfall() public {
        uint256 amount = 10_000;
        bytes32 secret = keccak256("rebase-1");
        uint64 deadline = uint64(block.timestamp) + 1 hours;

        rebaseToken.mint(owner, amount);
        vm.startPrank(owner);
        rebaseToken.approve(address(htlc), amount);
        bytes32 id = htlc.lock(
            address(rebaseToken), recipient, amount, sha256(abi.encodePacked(secret)), deadline
        );
        vm.stopPrank();

        // Downward rebase (-10%) leaves contract short of nominal `amount`.
        rebaseToken.setMultiplier(0.9e18);
        vm.expectRevert();
        htlc.claim(id, secret);
    }
}
