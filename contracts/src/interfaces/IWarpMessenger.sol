// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Subnet-EVM Warp precompile (graft/subnet-evm/precompile/contracts/warp).
struct WarpMessage {
    bytes32 sourceChainID;
    address originSenderAddress;
    bytes payload;
}

struct WarpBlockHash {
    bytes32 sourceChainID;
    bytes32 blockHash;
}

interface IWarpMessenger {
    event SendWarpMessage(address indexed sourceAddress, bytes32 indexed unsignedMessageID, bytes message);

    function sendWarpMessage(bytes calldata payload) external returns (bytes32 messageID);
    function getVerifiedWarpMessage(uint32 index) external view returns (WarpMessage memory message, bool valid);
    function getVerifiedWarpBlockHash(uint32 index) external view returns (WarpBlockHash memory warpBlockHash, bool valid);
    function getBlockchainID() external view returns (bytes32 blockchainID);
}
