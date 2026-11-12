// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWarpMessenger} from "../interfaces/IWarpMessenger.sol";

/// Go/no-go spike: emit one Warp message whose bytes the client predicted in advance.
contract WarpSpike {
    IWarpMessenger internal constant WARP = IWarpMessenger(0x0200000000000000000000000000000000000005);

    event Emitted(bytes32 messageID, bytes payload);

    function emitMessage(bytes calldata payload) external returns (bytes32 id) {
        id = WARP.sendWarpMessage(payload);
        emit Emitted(id, payload);
    }

    function blockchainID() external view returns (bytes32) {
        return WARP.getBlockchainID();
    }
}
