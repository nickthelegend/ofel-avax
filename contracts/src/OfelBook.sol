// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWarpMessenger} from "./interfaces/IWarpMessenger.sol";
import {Pedersen} from "./Pedersen.sol";

/// @title OfelBook — sealed-batch block trading on an Avalanche L1.
/// @notice Orders are sealed with warplock to the Warp message this contract emits when a batch
///         closes. The L1's validators only sign that message after the chain accepts closeBatch,
///         which reverts before closeAt, so no one (not the venue, not a single validator) can read
///         an order before the batch closes. At close, side and limit are revealed and checked
///         against each order's commitment; the uniform price is computed here from the limits.
///         Sizes are Pedersen commitments: the clearing agent proves batch totals against the sum of
///         the commitments, so individual sizes are never published. Funds settle in eERC.
contract OfelBook {
    IWarpMessenger internal constant WARP = IWarpMessenger(0x0200000000000000000000000000000000000005);

    /// Domain tag inside the Warp payload: abi.encode(CLOSE_TAG, batchId, closeAt).
    bytes32 public constant CLOSE_TAG = keccak256("ofel/batch-closed/v1");
    uint8 public constant BUY = 1;
    uint8 public constant SELL = 2;
    uint256 public constant MAX_ORDERS = 64;

    enum BatchState {
        None,
        Open,
        Closed,
        Cleared
    }

    enum OrderStatus {
        None,
        Sealed, // submitted, unreadable
        Revealed, // side + limit opened and matched the commitment
        Void, // never revealed, or voided by the agent (bond forfeited)
        Unfilled, // revealed but outside the clearing price (bond claimable)
        Filled, // inside the clearing price, settlement pending
        Settled, // both eERC legs confirmed by the agent (bond claimable)
        BondClaimed
    }

    struct Batch {
        uint64 closeAt;
        uint64 closedAt;
        uint64 clearedAt;
        uint32 orderCount;
        uint32 revealedCount;
        BatchState state;
        uint64 price; // quote cents per 1.00 base, uniform for every fill
        uint64 buyTotal; // base units (eERC decimals 2), sum over filled buys
        uint64 sellTotal; // base units, sum over filled sells
        bytes32 closeMessageId;
    }

    struct Order {
        address trader;
        uint8 side;
        OrderStatus status;
        uint64 limit;
        bytes32 commitment;
        uint256 cx; // Pedersen commitment to size, BN254 G1
        uint256 cy;
    }

    struct Reveal {
        uint32 index;
        uint8 side;
        uint64 limit;
        bytes32 salt;
        bytes32 agentBlobHash;
    }

    address public immutable agent;
    uint256 public immutable bond;
    uint64 public immutable revealWindow;
    uint64 public immutable settleWindow;
    /// x25519 public key the agent's size blobs are encrypted to (inside the timelock).
    bytes32 public agentKey;

    uint256 public batchCount;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => mapping(uint256 => Order)) public orders;
    mapping(bytes32 => bool) public commitmentUsed;

    event BatchOpened(uint256 indexed batchId, uint64 closeAt);
    event OrderSealed(
        uint256 indexed batchId, uint32 indexed index, address indexed trader, bytes32 commitment, uint256 cx, uint256 cy, bytes envelope
    );
    event BatchClosed(uint256 indexed batchId, bytes32 messageId, bytes payload);
    event OrderRevealed(uint256 indexed batchId, uint32 indexed index, uint8 side, uint64 limit);
    event OrderVoided(uint256 indexed batchId, uint32 indexed index, uint8 reason);
    event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled);
    event OrderSettled(uint256 indexed batchId, uint32 indexed index);
    event BondClaimed(uint256 indexed batchId, uint32 indexed index, address to, uint256 amount);
    event AgentKeySet(bytes32 key);

    error NotAgent();
    error UnknownBatch(uint256 batchId);
    error BadCloseTime();
    error BatchNotOpen(uint256 batchId);
    error OrderWindowClosed(uint64 closeAt, uint64 nowTs);
    error TooEarly(uint64 closeAt, uint64 nowTs);
    error AlreadyClosed(uint256 batchId);
    error BatchNotClosed(uint256 batchId);
    error WrongBond(uint256 sent, uint256 required);
    error DuplicateCommitment(bytes32 commitment);
    error BatchFull();
    error EmptyEnvelope();
    error BadSizeCommitment();
    error InvalidReveal(uint32 index);
    error NotSealed(uint32 index);
    error RevealStillOpen(uint64 deadline);
    error TotalsMismatch(uint8 side);
    error BadIndex(uint32 index);
    error BadStatus(uint32 index, OrderStatus status);
    error NotTrader();
    error SettleWindowOpen(uint64 deadline);
    error TransferFailed();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address agent_, bytes32 agentKey_, uint256 bond_, uint64 revealWindow_, uint64 settleWindow_) {
        agent = agent_;
        agentKey = agentKey_;
        bond = bond_;
        revealWindow = revealWindow_;
        settleWindow = settleWindow_;
        emit AgentKeySet(agentKey_);
    }

    function setAgentKey(bytes32 key) external onlyAgent {
        agentKey = key;
        emit AgentKeySet(key);
    }

    // ---------------------------------------------------------------- batches

    function openBatch(uint64 closeAt) external onlyAgent returns (uint256 batchId) {
        if (closeAt <= block.timestamp || closeAt > block.timestamp + 1 days) revert BadCloseTime();
        batchId = ++batchCount;
        Batch storage b = batches[batchId];
        b.closeAt = closeAt;
        b.state = BatchState.Open;
        emit BatchOpened(batchId, closeAt);
    }

    /// The exact Warp payload this batch will emit. warplock seals orders to it in advance.
    function closePayload(uint256 batchId) public view returns (bytes memory) {
        Batch storage b = batches[batchId];
        if (b.state == BatchState.None) revert UnknownBatch(batchId);
        return abi.encode(CLOSE_TAG, batchId, b.closeAt);
    }

    /// Commitment a trader publishes with an order. Binds chain, book, batch, trader, the
    /// revealed fields, the size commitment and the agent's encrypted size blob.
    function orderCommitment(
        uint256 batchId,
        address trader,
        uint8 side,
        uint64 limit,
        bytes32 salt,
        uint256 cx,
        uint256 cy,
        bytes32 agentBlobHash
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), batchId, trader, side, limit, salt, cx, cy, agentBlobHash));
    }

    function submitOrder(uint256 batchId, bytes32 commitment, uint256 cx, uint256 cy, bytes calldata envelope)
        external
        payable
        returns (uint32 index)
    {
        Batch storage b = batches[batchId];
        if (b.state != BatchState.Open) revert BatchNotOpen(batchId);
        if (block.timestamp >= b.closeAt) revert OrderWindowClosed(b.closeAt, uint64(block.timestamp));
        if (msg.value != bond) revert WrongBond(msg.value, bond);
        if (envelope.length == 0) revert EmptyEnvelope();
        if (commitmentUsed[commitment]) revert DuplicateCommitment(commitment);
        if (b.orderCount >= MAX_ORDERS) revert BatchFull();
        if (!Pedersen.onCurve(cx, cy)) revert BadSizeCommitment();
        commitmentUsed[commitment] = true;
        index = b.orderCount++;
        orders[batchId][index] =
            Order({trader: msg.sender, side: 0, status: OrderStatus.Sealed, limit: 0, commitment: commitment, cx: cx, cy: cy});
        emit OrderSealed(batchId, index, msg.sender, commitment, cx, cy, envelope);
    }

    /// Anyone, once closeAt has passed. Emits the Warp message whose validator signatures open the batch.
    function closeBatch(uint256 batchId) external returns (bytes32 messageId) {
        Batch storage b = batches[batchId];
        if (b.state == BatchState.None) revert UnknownBatch(batchId);
        if (b.state != BatchState.Open) revert AlreadyClosed(batchId);
        if (block.timestamp < b.closeAt) revert TooEarly(b.closeAt, uint64(block.timestamp));
        bytes memory payload = abi.encode(CLOSE_TAG, batchId, b.closeAt);
        messageId = WARP.sendWarpMessage(payload);
        b.state = BatchState.Closed;
        b.closedAt = uint64(block.timestamp);
        b.closeMessageId = messageId;
        emit BatchClosed(batchId, messageId, payload);
    }

    /// Anyone who has opened envelopes (with validator signatures) posts the reveals.
    function revealOrders(uint256 batchId, Reveal[] calldata reveals) external {
        Batch storage b = batches[batchId];
        if (b.state != BatchState.Closed) revert BatchNotClosed(batchId);
        for (uint256 i = 0; i < reveals.length; i++) {
            Reveal calldata r = reveals[i];
            if (r.index >= b.orderCount) revert BadIndex(r.index);
            Order storage o = orders[batchId][r.index];
            if (o.status != OrderStatus.Sealed) revert NotSealed(r.index);
            if (r.side != BUY && r.side != SELL) revert InvalidReveal(r.index);
            bytes32 c = orderCommitment(batchId, o.trader, r.side, r.limit, r.salt, o.cx, o.cy, r.agentBlobHash);
            if (c != o.commitment) revert InvalidReveal(r.index);
            o.side = r.side;
            o.limit = r.limit;
            o.status = OrderStatus.Revealed;
            b.revealedCount++;
            emit OrderRevealed(batchId, r.index, r.side, r.limit);
        }
    }

    function revealDeadline(uint256 batchId) public view returns (uint64) {
        return batches[batchId].closedAt + revealWindow;
    }

    /// Uniform clearing price from revealed limits only (sizes are never needed to find it):
    /// sort bids high→low and asks low→high, walk while bid ≥ ask; the price is the midpoint
    /// of the last crossing pair. Returns 0 when nothing crosses.
    function clearingPrice(uint256 batchId) public view returns (uint64 price) {
        Batch storage b = batches[batchId];
        uint64[] memory bids = new uint64[](b.orderCount);
        uint64[] memory asks = new uint64[](b.orderCount);
        uint256 nb;
        uint256 na;
        for (uint256 i = 0; i < b.orderCount; i++) {
            Order storage o = orders[batchId][i];
            if (o.status != OrderStatus.Revealed) continue;
            if (o.side == BUY) bids[nb++] = o.limit;
            else asks[na++] = o.limit;
        }
        _sort(bids, nb, true);
        _sort(asks, na, false);
        uint256 k;
        while (k < nb && k < na && bids[k] >= asks[k]) k++;
        if (k == 0) return 0;
        price = uint64((uint256(bids[k - 1]) + uint256(asks[k - 1])) / 2);
    }

    /// The clearing agent proves the batch totals against the Pedersen commitments:
    /// Σ C(filled buys) == buyTotal·G + buyBlind·H, same for sells. Individual sizes stay hidden.
    /// voids: revealed orders the agent rejects (envelope did not open to the reveal, size out of
    /// range, unreadable size blob); reasons are logged for the public audit.
    function clear(
        uint256 batchId,
        uint32[] calldata voids,
        uint8[] calldata voidReasons,
        uint64 buyTotal,
        uint256 buyBlind,
        uint64 sellTotal,
        uint256 sellBlind
    ) external onlyAgent {
        Batch storage b = batches[batchId];
        if (b.state != BatchState.Closed) revert BatchNotClosed(batchId);
        if (b.revealedCount < b.orderCount && block.timestamp < revealDeadline(batchId)) {
            revert RevealStillOpen(revealDeadline(batchId));
        }
        for (uint256 i = 0; i < voids.length; i++) {
            Order storage v = orders[batchId][voids[i]];
            if (voids[i] >= b.orderCount || v.status != OrderStatus.Revealed) revert BadStatus(voids[i], v.status);
            v.status = OrderStatus.Void;
            emit OrderVoided(batchId, voids[i], voidReasons[i]);
        }
        uint64 price = clearingPrice(batchId);
        (uint256[2] memory buySum, uint256[2] memory sellSum, uint32 filled) = _tally(batchId, b.orderCount, price);
        if (!Pedersen.opens(buySum, buyTotal, buyBlind)) revert TotalsMismatch(BUY);
        if (!Pedersen.opens(sellSum, sellTotal, sellBlind)) revert TotalsMismatch(SELL);
        b.state = BatchState.Cleared;
        b.clearedAt = uint64(block.timestamp);
        b.price = price;
        b.buyTotal = buyTotal;
        b.sellTotal = sellTotal;
        emit BatchCleared(batchId, price, buyTotal, sellTotal, filled);
    }

    /// Pro-rata fill for a filled order of `size` base units. The long side is scaled down.
    function fillFor(uint256 batchId, uint8 side, uint64 size) public view returns (uint64 base, uint64 quote) {
        Batch storage b = batches[batchId];
        uint64 mine = side == BUY ? b.buyTotal : b.sellTotal;
        uint64 other = side == BUY ? b.sellTotal : b.buyTotal;
        base = mine <= other ? size : uint64((uint256(size) * other) / mine);
        quote = uint64((uint256(base) * b.price) / 100);
    }

    // ------------------------------------------------------------- settlement

    /// The agent confirms both eERC legs of a filled order (it decrypts them as the eERC auditor).
    function markSettled(uint256 batchId, uint32 index) external onlyAgent {
        Order storage o = orders[batchId][index];
        if (o.status != OrderStatus.Filled) revert BadStatus(index, o.status);
        o.status = OrderStatus.Settled;
        emit OrderSettled(batchId, index);
    }

    function settleDeadline(uint256 batchId) public view returns (uint64) {
        return batches[batchId].clearedAt + settleWindow;
    }

    /// Traders reclaim the bond once unfilled or settled.
    function claimBond(uint256 batchId, uint32 index) external {
        Order storage o = orders[batchId][index];
        if (msg.sender != o.trader) revert NotTrader();
        if (o.status != OrderStatus.Unfilled && o.status != OrderStatus.Settled) revert BadStatus(index, o.status);
        o.status = OrderStatus.BondClaimed;
        _pay(o.trader, bond);
        emit BondClaimed(batchId, index, o.trader, bond);
    }

    /// Bonds of void orders, and of filled orders that did not settle in time, go to the agent.
    function sweepBond(uint256 batchId, uint32 index) external onlyAgent {
        Order storage o = orders[batchId][index];
        bool lapsed = o.status == OrderStatus.Filled;
        if (lapsed && block.timestamp < settleDeadline(batchId)) revert SettleWindowOpen(settleDeadline(batchId));
        if (o.status != OrderStatus.Void && !lapsed) revert BadStatus(index, o.status);
        o.status = OrderStatus.BondClaimed;
        _pay(agent, bond);
        emit BondClaimed(batchId, index, agent, bond);
    }

    // ------------------------------------------------------------------ views

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    function getOrders(uint256 batchId) external view returns (Order[] memory out) {
        Batch storage b = batches[batchId];
        out = new Order[](b.orderCount);
        for (uint256 i = 0; i < b.orderCount; i++) {
            out[i] = orders[batchId][i];
        }
    }

    // -------------------------------------------------------------- internals

    function _tally(uint256 batchId, uint32 count, uint64 price)
        internal
        returns (uint256[2] memory buySum, uint256[2] memory sellSum, uint32 filled)
    {
        for (uint32 i = 0; i < count; i++) {
            Order storage o = orders[batchId][i];
            if (o.status == OrderStatus.Sealed) {
                o.status = OrderStatus.Void; // never revealed: forfeits its bond
                emit OrderVoided(batchId, i, 0);
                continue;
            }
            if (o.status != OrderStatus.Revealed) continue;
            bool inCross = price != 0 && (o.side == BUY ? o.limit >= price : o.limit <= price);
            if (!inCross) {
                o.status = OrderStatus.Unfilled;
                continue;
            }
            o.status = OrderStatus.Filled;
            filled++;
            if (o.side == BUY) buySum = Pedersen.add(buySum, [o.cx, o.cy]);
            else sellSum = Pedersen.add(sellSum, [o.cx, o.cy]);
        }
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _sort(uint64[] memory a, uint256 n, bool desc) internal pure {
        for (uint256 i = 1; i < n; i++) {
            uint64 key = a[i];
            uint256 j = i;
            while (j > 0 && (desc ? a[j - 1] < key : a[j - 1] > key)) {
                a[j] = a[j - 1];
                j--;
            }
            a[j] = key;
        }
    }
}
