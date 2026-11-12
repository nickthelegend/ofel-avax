// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Judge faucet on the Ofel L1. One drip per address: OFEL for gas and the bond, plus the two test assets.
/// A new wallet holds no OFEL and cannot pay gas, so a relayer (the operator) calls drip() for it; the
/// faucet pays from its own balance. Testnet tokens only, no value.
contract OfelFaucet is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable tAVAX;
    IERC20 public immutable tUSDC;
    uint256 public immutable gasAmount;
    uint256 public immutable avaxAmount;
    uint256 public immutable usdcAmount;
    address public operator;
    mapping(address => bool) public claimed;
    uint256 public drips;

    event Dripped(address indexed to, uint256 gas, uint256 tAVAX, uint256 tUSDC);
    event OperatorSet(address operator);

    error NotOperator();
    error AlreadyClaimed(address to);
    error Empty();
    error ZeroAddress();

    constructor(address owner_, address operator_, IERC20 tAVAX_, IERC20 tUSDC_, uint256 gas_, uint256 avax_, uint256 usdc_)
        Ownable(owner_)
    {
        operator = operator_;
        tAVAX = tAVAX_;
        tUSDC = tUSDC_;
        gasAmount = gas_;
        avaxAmount = avax_;
        usdcAmount = usdc_;
        emit OperatorSet(operator_);
    }

    receive() external payable {}

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// Fund a new wallet once. Called by the operator (relayer) because the wallet has no gas yet.
    function drip(address payable to) external {
        if (msg.sender != operator) revert NotOperator();
        if (to == address(0)) revert ZeroAddress();
        if (claimed[to]) revert AlreadyClaimed(to);
        if (address(this).balance < gasAmount || tAVAX.balanceOf(address(this)) < avaxAmount || tUSDC.balanceOf(address(this)) < usdcAmount) {
            revert Empty();
        }
        claimed[to] = true;
        drips++;
        tAVAX.safeTransfer(to, avaxAmount);
        tUSDC.safeTransfer(to, usdcAmount);
        (bool ok,) = to.call{value: gasAmount}("");
        require(ok, "gas transfer failed");
        emit Dripped(to, gasAmount, avaxAmount, usdcAmount);
    }

    /// Owner recovers what is left (native OFEL and the test assets).
    function sweep(address payable to) external onlyOwner {
        tAVAX.safeTransfer(to, tAVAX.balanceOf(address(this)));
        tUSDC.safeTransfer(to, tUSDC.balanceOf(address(this)));
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "sweep failed");
    }
}
