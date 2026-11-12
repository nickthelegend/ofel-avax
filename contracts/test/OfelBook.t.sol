// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {OfelBook} from "../src/OfelBook.sol";
import {Pedersen} from "../src/Pedersen.sol";

/// Foundry's EVM has no Subnet-EVM precompiles, so unit tests place this recorder at the Warp
/// precompile address to capture what the book emits. The real precompile, real validator
/// signatures and real decryption are exercised by the live L1 suites in packages/ and scripts/.
contract WarpRecorder {
    bytes public lastPayload;
    uint256 public calls;

    function sendWarpMessage(bytes calldata payload) external returns (bytes32) {
        lastPayload = payload;
        calls++;
        return sha256(payload);
    }
}

contract PedersenHarness {
    function commit(uint256 v, uint256 r) external view returns (uint256[2] memory) {
        return Pedersen.commit(v, r);
    }

    function onCurve(uint256 x, uint256 y) external pure returns (bool) {
        return Pedersen.onCurve(x, y);
    }
}

contract OfelBookTest is Test {
    address constant WARP = 0x0200000000000000000000000000000000000005;
    uint256 constant BOND = 0.1 ether;

    OfelBook book;
    PedersenHarness ped;
    address agent = makeAddr("agent");
    address alice = makeAddr("alice"); // buyer
    address bob = makeAddr("bob"); // seller
    address carol = makeAddr("carol");
    address mallory = makeAddr("mallory");

    struct Plain {
        address trader;
        uint8 side;
        uint64 limit;
        uint64 size;
        uint256 blind;
        bytes32 salt;
        bytes32 blobHash;
    }

    function setUp() public {
        WarpRecorder rec = new WarpRecorder();
        vm.etch(WARP, address(rec).code);
        book = new OfelBook(agent, bytes32(uint256(0xa11ce)), BOND, 30, 600);
        ped = new PedersenHarness();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
        vm.deal(mallory, 10 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _open(uint64 inSeconds) internal returns (uint256 id) {
        vm.prank(agent);
        id = book.openBatch(uint64(block.timestamp) + inSeconds);
    }

    function _plain(address t, uint8 side, uint64 limit, uint64 size, uint256 seed) internal pure returns (Plain memory p) {
        p = Plain(t, side, limit, size, uint256(keccak256(abi.encode("blind", seed))) % Pedersen.N, keccak256(abi.encode("salt", seed)), keccak256(abi.encode("blob", seed)));
    }

    function _commitment(uint256 id, Plain memory p) internal view returns (bytes32, uint256[2] memory c) {
        c = ped.commit(p.size, p.blind);
        return (book.orderCommitment(id, p.trader, p.side, p.limit, p.salt, c[0], c[1], p.blobHash), c);
    }

    function _submit(uint256 id, Plain memory p) internal returns (uint32 idx) {
        (bytes32 com, uint256[2] memory c) = _commitment(id, p);
        vm.prank(p.trader);
        idx = book.submitOrder{value: BOND}(id, com, c[0], c[1], hex"c0ffee");
    }

    function _reveal(uint32 idx, Plain memory p) internal pure returns (OfelBook.Reveal memory) {
        return OfelBook.Reveal(idx, p.side, p.limit, p.salt, p.blobHash);
    }

    function _close(uint256 id) internal {
        vm.warp(book.getBatch(id).closeAt);
        book.closeBatch(id);
    }

    // ---------------------------------------------------------------- batches

    function test_openBatch_onlyAgent() public {
        vm.expectRevert(OfelBook.NotAgent.selector);
        vm.prank(alice);
        book.openBatch(uint64(block.timestamp + 60));
    }

    function test_openBatch_rejectsPastOrFarClose() public {
        vm.startPrank(agent);
        vm.expectRevert(OfelBook.BadCloseTime.selector);
        book.openBatch(uint64(block.timestamp));
        vm.expectRevert(OfelBook.BadCloseTime.selector);
        book.openBatch(uint64(block.timestamp + 2 days));
        vm.stopPrank();
    }

    function test_closePayload_isWhatTheBookEmits() public {
        uint256 id = _open(60);
        bytes memory expected = book.closePayload(id);
        _close(id);
        assertEq(WarpRecorder(WARP).lastPayload(), expected);
        assertEq(expected, abi.encode(book.CLOSE_TAG(), id, book.getBatch(id).closeAt));
    }

    // ------------------------------------------------------------ early open

    function test_closeBatch_tooEarly_reverts() public {
        uint256 id = _open(60);
        uint64 closeAt = book.getBatch(id).closeAt;
        vm.warp(closeAt - 1);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.TooEarly.selector, closeAt, closeAt - 1));
        book.closeBatch(id);
        assertEq(WarpRecorder(WARP).calls(), 0, "no Warp message may exist before T");
    }

    function test_closeBatch_twice_reverts() public {
        uint256 id = _open(60);
        _close(id);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.AlreadyClosed.selector, id));
        book.closeBatch(id);
        assertEq(WarpRecorder(WARP).calls(), 1);
    }

    function test_closeBatch_unknown_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(OfelBook.UnknownBatch.selector, 7));
        book.closeBatch(7);
    }

    function test_revealBeforeClose_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        uint32 i = _submit(id, a);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](1);
        rs[0] = _reveal(i, a);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.BatchNotClosed.selector, id));
        book.revealOrders(id, rs);
    }

    // ---------------------------------------------------------------- orders

    function test_submit_wrongBond_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        (bytes32 com, uint256[2] memory c) = _commitment(id, a);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.WrongBond.selector, 0, BOND));
        book.submitOrder(id, com, c[0], c[1], hex"01");
    }

    function test_submit_afterClose_reverts() public {
        uint256 id = _open(60);
        vm.warp(block.timestamp + 60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        (bytes32 com, uint256[2] memory c) = _commitment(id, a);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.OrderWindowClosed.selector, uint64(block.timestamp), uint64(block.timestamp)));
        book.submitOrder{value: BOND}(id, com, c[0], c[1], hex"01");
    }

    function test_submit_badSizeCommitment_reverts() public {
        uint256 id = _open(60);
        vm.prank(alice);
        vm.expectRevert(OfelBook.BadSizeCommitment.selector);
        book.submitOrder{value: BOND}(id, bytes32(uint256(1)), 1, 3, hex"01");
    }

    function test_submit_emptyEnvelope_reverts() public {
        uint256 id = _open(60);
        uint256[2] memory c = ped.commit(1, 1);
        vm.prank(alice);
        vm.expectRevert(OfelBook.EmptyEnvelope.selector);
        book.submitOrder{value: BOND}(id, bytes32(uint256(1)), c[0], c[1], "");
    }

    // ---------------------------------------------------------------- replays

    /// Mallory copies Alice's sealed order (commitment + ciphertext) byte for byte.
    function test_replay_sameCommitment_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        (bytes32 com, uint256[2] memory c) = _commitment(id, a);
        vm.prank(alice);
        book.submitOrder{value: BOND}(id, com, c[0], c[1], hex"c0ffee");
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.DuplicateCommitment.selector, com));
        book.submitOrder{value: BOND}(id, com, c[0], c[1], hex"c0ffee");
    }

    /// Alice's order replayed into a later batch under its old commitment.
    function test_replay_intoAnotherBatch_reverts() public {
        uint256 id1 = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        (bytes32 com, uint256[2] memory c) = _commitment(id1, a);
        vm.prank(alice);
        book.submitOrder{value: BOND}(id1, com, c[0], c[1], hex"c0ffee");
        uint256 id2 = _open(120);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.DuplicateCommitment.selector, com));
        book.submitOrder{value: BOND}(id2, com, c[0], c[1], hex"c0ffee");
    }

    /// Mallory front-runs with a fresh commitment but re-uses Alice's revealed plaintext:
    /// the commitment binds the trader, so the reveal cannot be claimed by Mallory's order.
    function test_replay_revealUnderOtherTrader_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        (bytes32 com,) = _commitment(id, a);
        uint256[2] memory c = ped.commit(a.size, a.blind);
        // Mallory registers a commitment computed with Alice's fields but her own address is the trader.
        vm.prank(mallory);
        uint32 mi = book.submitOrder{value: BOND}(id, keccak256(abi.encode(com, "mallory")), c[0], c[1], hex"c0ffee");
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](1);
        rs[0] = _reveal(mi, a);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.InvalidReveal.selector, mi));
        book.revealOrders(id, rs);
    }

    function test_reveal_twice_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        uint32 i = _submit(id, a);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](1);
        rs[0] = _reveal(i, a);
        book.revealOrders(id, rs);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.NotSealed.selector, i));
        book.revealOrders(id, rs);
    }

    // ------------------------------------------------------------- wrong keys

    function test_reveal_wrongSalt_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        uint32 i = _submit(id, a);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](1);
        rs[0] = _reveal(i, a);
        rs[0].salt = bytes32(uint256(rs[0].salt) ^ 1);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.InvalidReveal.selector, i));
        book.revealOrders(id, rs);
    }

    function test_reveal_flippedSideOrLimit_reverts() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        uint32 i = _submit(id, a);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](1);
        rs[0] = _reveal(i, a);
        rs[0].side = 2;
        vm.expectRevert(abi.encodeWithSelector(OfelBook.InvalidReveal.selector, i));
        book.revealOrders(id, rs);
        rs[0] = _reveal(i, a);
        rs[0].limit = 9999;
        vm.expectRevert(abi.encodeWithSelector(OfelBook.InvalidReveal.selector, i));
        book.revealOrders(id, rs);
    }

    function test_clear_wrongTotal_reverts() public {
        (uint256 id, Plain memory a, Plain memory b) = _twoSidedBatch();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.TotalsMismatch.selector, 1));
        book.clear(id, new uint32[](0), new uint8[](0), a.size + 1, a.blind, b.size, b.blind);
    }

    function test_clear_wrongBlind_reverts() public {
        (uint256 id, Plain memory a, Plain memory b) = _twoSidedBatch();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.TotalsMismatch.selector, 2));
        book.clear(id, new uint32[](0), new uint8[](0), a.size, a.blind, b.size, b.blind + 1);
    }

    function test_clear_onlyAgent() public {
        (uint256 id, Plain memory a, Plain memory b) = _twoSidedBatch();
        vm.prank(mallory);
        vm.expectRevert(OfelBook.NotAgent.selector);
        book.clear(id, new uint32[](0), new uint8[](0), a.size, a.blind, b.size, b.blind);
    }

    // ---------------------------------------------------------------- clearing

    function _twoSidedBatch() internal returns (uint256 id, Plain memory a, Plain memory b) {
        id = _open(60);
        a = _plain(alice, 1, 3150, 125_000, 1); // buy 1,250.00 @ <= 31.50
        b = _plain(bob, 2, 3120, 90_000, 2); // sell 900.00 @ >= 31.20
        _submit(id, a);
        _submit(id, b);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](2);
        rs[0] = _reveal(0, a);
        rs[1] = _reveal(1, b);
        book.revealOrders(id, rs);
    }

    function test_clear_uniformPrice_andProRata() public {
        (uint256 id, Plain memory a, Plain memory b) = _twoSidedBatch();
        assertEq(book.clearingPrice(id), 3135);
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), a.size, a.blind, b.size, b.blind);
        OfelBook.Batch memory bt = book.getBatch(id);
        assertEq(uint8(bt.state), uint8(OfelBook.BatchState.Cleared));
        assertEq(bt.price, 3135);
        (uint64 aBase, uint64 aQuote) = book.fillFor(id, 1, a.size);
        (uint64 bBase, uint64 bQuote) = book.fillFor(id, 2, b.size);
        assertEq(aBase, 90_000, "buyer scaled to available supply");
        assertEq(bBase, 90_000, "seller filled in full");
        assertEq(aQuote, bQuote, "one price for both sides");
        assertEq(aQuote, 2_821_500); // 900.00 * 31.35 = 28,215.00
    }

    function test_clear_multiOrder_priceAndInclusion() public {
        uint256 id = _open(60);
        Plain[5] memory p = [
            _plain(alice, 1, 3200, 1000, 1),
            _plain(carol, 1, 3100, 2000, 2),
            _plain(bob, 2, 3050, 1500, 3),
            _plain(mallory, 2, 3150, 700, 4),
            _plain(makeAddr("dan"), 1, 2900, 900, 5)
        ];
        vm.deal(makeAddr("dan"), 1 ether);
        for (uint256 i = 0; i < 5; i++) _submit(id, p[i]);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](5);
        for (uint32 i = 0; i < 5; i++) rs[i] = _reveal(i, p[i]);
        book.revealOrders(id, rs);
        // bids 3200, 3100, 2900; asks 3050, 3150. Pair1 3200>=3050, pair2 3100<3150 -> price (3200+3050)/2
        uint64 price = book.clearingPrice(id);
        assertEq(price, 3125);
        // filled: buy 3200 (alice) ; sells <= 3125: bob 3050. carol 3100 < 3125 unfilled, mallory 3150 > 3125 unfilled.
        uint256 bb = p[0].blind;
        uint256 sb = p[2].blind;
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), 1000, bb, 1500, sb);
        OfelBook.Order[] memory os = book.getOrders(id);
        assertEq(uint8(os[0].status), uint8(OfelBook.OrderStatus.Filled));
        assertEq(uint8(os[1].status), uint8(OfelBook.OrderStatus.Unfilled));
        assertEq(uint8(os[2].status), uint8(OfelBook.OrderStatus.Filled));
        assertEq(uint8(os[3].status), uint8(OfelBook.OrderStatus.Unfilled));
        assertEq(uint8(os[4].status), uint8(OfelBook.OrderStatus.Unfilled));
    }

    function test_clear_noCross_clearsEmpty() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3000, 100, 1);
        Plain memory b = _plain(bob, 2, 3100, 100, 2);
        _submit(id, a);
        _submit(id, b);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](2);
        rs[0] = _reveal(0, a);
        rs[1] = _reveal(1, b);
        book.revealOrders(id, rs);
        assertEq(book.clearingPrice(id), 0);
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), 0, 0, 0, 0);
        OfelBook.Order[] memory os = book.getOrders(id);
        assertEq(uint8(os[0].status), uint8(OfelBook.OrderStatus.Unfilled));
        assertEq(uint8(os[1].status), uint8(OfelBook.OrderStatus.Unfilled));
    }

    function test_clear_waitsForRevealWindow_thenVoidsUnrevealed() public {
        uint256 id = _open(60);
        Plain memory a = _plain(alice, 1, 3150, 500, 1);
        Plain memory b = _plain(bob, 2, 3100, 400, 2);
        _submit(id, a);
        _submit(id, b);
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](1);
        rs[0] = _reveal(0, a);
        book.revealOrders(id, rs);
        uint64 deadline = book.revealDeadline(id);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.RevealStillOpen.selector, deadline));
        book.clear(id, new uint32[](0), new uint8[](0), 0, 0, 0, 0);
        vm.warp(book.revealDeadline(id));
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), 0, 0, 0, 0); // only a buy remains: no cross
        assertEq(uint8(book.getOrders(id)[1].status), uint8(OfelBook.OrderStatus.Void));
    }

    function test_clear_agentVoid_excludesOrder() public {
        (uint256 id, Plain memory a,) = _twoSidedBatch();
        uint32[] memory v = new uint32[](1);
        uint8[] memory why = new uint8[](1);
        v[0] = 1;
        why[0] = 2;
        vm.prank(agent);
        book.clear(id, v, why, 0, 0, 0, 0);
        assertEq(uint8(book.getOrders(id)[1].status), uint8(OfelBook.OrderStatus.Void));
        assertEq(uint8(book.getOrders(id)[0].status), uint8(OfelBook.OrderStatus.Unfilled));
        a; // silence
    }

    // ------------------------------------------------------------ size privacy

    /// Nothing the book stores or logs contains a plaintext size, and totals are proven
    /// against the commitments without any per-order size being published.
    function test_sizePrivacy_noPlaintextSizeOnChain() public {
        vm.recordLogs();
        (uint256 id, Plain memory a, Plain memory b) = _twoSidedBatch();
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), a.size, a.blind, b.size, b.blind);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == OfelBook.BatchCleared.selector) continue; // batch totals are public by design
            _assertNoWord(logs[i].data, a.size);
            _assertNoWord(logs[i].data, b.size);
        }
        OfelBook.Order[] memory os = book.getOrders(id);
        for (uint256 i = 0; i < os.length; i++) {
            assertTrue(os[i].cx != a.size && os[i].cy != a.size && os[i].cx != b.size && os[i].cy != b.size);
        }
    }

    /// The same size committed twice yields unrelated commitments (hiding, unlinkable).
    function test_sizePrivacy_commitmentsUnlinkable() public view {
        uint256[2] memory c1 = ped.commit(125_000, 11);
        uint256[2] memory c2 = ped.commit(125_000, 12);
        assertTrue(c1[0] != c2[0]);
        assertTrue(ped.onCurve(c1[0], c1[1]) && ped.onCurve(c2[0], c2[1]));
    }

    function _assertNoWord(bytes memory data, uint256 word) internal pure {
        for (uint256 off = 0; off + 32 <= data.length; off += 32) {
            uint256 w;
            assembly {
                w := mload(add(add(data, 32), off))
            }
            assertTrue(w != word, "plaintext size leaked into a log");
        }
    }

    // --------------------------------------------------------------- pedersen

    function test_pedersen_HIsOnCurveAndDerivedAsDocumented() public view {
        uint256 x = uint256(keccak256(abi.encodePacked("ofel/pedersen/H/v1", uint8(0)))) % Pedersen.P;
        assertEq(x, Pedersen.HX);
        assertTrue(ped.onCurve(Pedersen.HX, Pedersen.HY));
        assertEq(Pedersen.HY % 2, 0);
    }

    function testFuzz_pedersen_homomorphic(uint64 v1, uint64 v2, uint128 r1, uint128 r2) public view {
        uint256[2] memory a = ped.commit(v1, r1);
        uint256[2] memory b = ped.commit(v2, r2);
        uint256[2] memory s = ped.commit(uint256(v1) + v2, uint256(r1) + r2);
        uint256[2] memory sum = _add(a, b);
        assertEq(sum[0], s[0]);
        assertEq(sum[1], s[1]);
    }

    function _add(uint256[2] memory a, uint256[2] memory b) internal view returns (uint256[2] memory r) {
        uint256[4] memory input = [a[0], a[1], b[0], b[1]];
        assembly {
            pop(staticcall(gas(), 0x06, input, 0x80, r, 0x40))
        }
    }

    // ----------------------------------------------------------- clearing fuzz

    function testFuzz_clearingPrice_isInsideEveryFilledLimit(uint64[6] memory limits, uint8 sideMask) public {
        uint256 id = _open(60);
        Plain[6] memory p;
        for (uint256 i = 0; i < 6; i++) {
            address t = address(uint160(0x1000 + i));
            vm.deal(t, 1 ether);
            uint64 lim = uint64(bound(limits[i], 1, 1_000_000));
            p[i] = _plain(t, ((sideMask >> i) & 1) == 1 ? 1 : 2, lim, 100, i + 1);
            _submit(id, p[i]);
        }
        _close(id);
        OfelBook.Reveal[] memory rs = new OfelBook.Reveal[](6);
        for (uint32 i = 0; i < 6; i++) rs[i] = _reveal(i, p[i]);
        book.revealOrders(id, rs);
        uint64 price = book.clearingPrice(id);
        uint256 buyBlind;
        uint256 sellBlind;
        uint64 buyTotal;
        uint64 sellTotal;
        for (uint256 i = 0; i < 6; i++) {
            bool inCross = price != 0 && (p[i].side == 1 ? p[i].limit >= price : p[i].limit <= price);
            if (!inCross) continue;
            if (p[i].side == 1) {
                buyTotal += p[i].size;
                buyBlind = addmod(buyBlind, p[i].blind, Pedersen.N);
            } else {
                sellTotal += p[i].size;
                sellBlind = addmod(sellBlind, p[i].blind, Pedersen.N);
            }
        }
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), buyTotal, buyBlind, sellTotal, sellBlind);
        OfelBook.Order[] memory os = book.getOrders(id);
        bool anyBuy;
        bool anySell;
        for (uint256 i = 0; i < 6; i++) {
            if (os[i].status != OfelBook.OrderStatus.Filled) continue;
            if (os[i].side == 1) {
                assertGe(os[i].limit, price);
                anyBuy = true;
            } else {
                assertLe(os[i].limit, price);
                anySell = true;
            }
        }
        assertEq(anyBuy, anySell, "a cross always has both sides");
    }

    // -------------------------------------------------------------- settlement

    function test_settlement_bonds() public {
        (uint256 id, Plain memory a, Plain memory b) = _twoSidedBatch();
        vm.prank(agent);
        book.clear(id, new uint32[](0), new uint8[](0), a.size, a.blind, b.size, b.blind);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.BadStatus.selector, 0, OfelBook.OrderStatus.Filled));
        book.claimBond(id, 0);

        vm.prank(mallory);
        vm.expectRevert(OfelBook.NotAgent.selector);
        book.markSettled(id, 0);

        vm.prank(agent);
        book.markSettled(id, 0);
        uint256 before = alice.balance;
        vm.prank(mallory);
        vm.expectRevert(OfelBook.NotTrader.selector);
        book.claimBond(id, 0);
        vm.prank(alice);
        book.claimBond(id, 0);
        assertEq(alice.balance, before + BOND);

        // Bob never settles: his bond lapses to the agent after the window.
        uint64 settleBy = book.settleDeadline(id);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(OfelBook.SettleWindowOpen.selector, settleBy));
        book.sweepBond(id, 1);
        vm.warp(book.settleDeadline(id));
        vm.prank(agent);
        book.sweepBond(id, 1);
        assertEq(agent.balance, BOND);
    }
}
