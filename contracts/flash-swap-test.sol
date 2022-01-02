// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.0;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol';
import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';

import '@uniswap/v3-periphery/contracts/base/PeripheryPayments.sol';
import '@uniswap/v3-periphery/contracts/base/PeripheryImmutableState.sol';
import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/libraries/CallbackValidation.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';

contract PairFlashTest is IUniswapV3FlashCallback, PeripheryPayments {
    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;

    event debug(string indexed description);

    ISwapRouter public immutable swapRouter;

    struct FlashParams {
        address token0;
        address token1;
        uint24 fee1; // Use to calc poolKey, borrow fee
        uint256 amount0; // Amount of token0 to borrow
        uint256 amount1; // Amount of token1 to borrow
        uint24 fee2; // Pass on to callback, first swap
        uint24 fee3; // Pass on to callback, second swap
    }

    struct FlashCallbackData {
        uint256 amount0;
        uint256 amount1;
        address payer;
        PoolAddress.PoolKey poolKey;
        uint24 poolFee2;
        uint24 poolFee3;
    }

    constructor(ISwapRouter _swapRouter, address _factory, address _WETH9) PeripheryImmutableState(_factory, _WETH9) {
        swapRouter = _swapRouter;
        emit debug('Contract constructed');
    }

    function initFlash(FlashParams memory params) external {
        emit debug('initFlash called');
        // Get the poolKey, just like my own motions key
        PoolAddress.PoolKey memory poolKey =
            PoolAddress.PoolKey({token0: params.token0, token1: params.token1, fee: params.fee1});
        emit debug('poolKey assigned');

        // Instantiate the pool object, just like my motions
        IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey));
        emit debug('pool object instantiated');

        // Call flash to take out loan, will then call uniswapV3FlashCallback passing in data,
        // loan has to be paid back at end
        pool.flash(
            address(this),
            params.amount0,
            params.amount1,
            abi.encode(
                FlashCallbackData({
                    amount0: params.amount0,
                    amount1: params.amount1,
                    payer: msg.sender,
                    poolKey: poolKey,
                    poolFee2: params.fee2,
                    poolFee3: params.fee3
                })
            )
        );
        emit debug('pool.flash() completed!');
    }

    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external override {
        emit debug('uniswapV3FlashCallback called');
        // Decode the data arg
        FlashCallbackData memory decoded = abi.decode(data, (FlashCallbackData));
        emit debug('data decoded');

        // Verify that call originated from genuine v3 pool
        CallbackValidation.verifyCallback(factory, decoded.poolKey);
        emit debug('call origin verified');

        // Approve router to spend tokens
        address token0 = decoded.poolKey.token0;
        address token1 = decoded.poolKey.token1;
        TransferHelper.safeApprove(token0, address(swapRouter), decoded.amount0);
        TransferHelper.safeApprove(token1, address(swapRouter), decoded.amount1);
        emit debug('tokens approved for swapRouter');

        // Set min to make sure swap is profitable
        uint256 amount1Min = LowGasSafeMath.add(decoded.amount1, fee1);
        uint256 amount0Min = LowGasSafeMath.add(decoded.amount0, fee0);
        emit debug('amountXMins calculated');

        // Execute swaps
        uint256 amountOut0 = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token1,
                tokenOut: token0,
                fee: decoded.poolFee2,
                recipient: address(this),
                deadline: block.timestamp + 200,
                amountIn: decoded.amount1,
                amountOutMinimum: amount0Min,
                sqrtPriceLimitX96: 0
            }));
        emit debug('First swap succeeded');
        uint256 amountOut1 = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token0,
                tokenOut: token1,
                fee: decoded.poolFee3,
                recipient: address(this),
                deadline: block.timestamp + 200,
                amountIn: decoded.amount0,
                amountOutMinimum: amount1Min,
                sqrtPriceLimitX96: 0
            }));
        emit debug('Second swap succeeded');

        // Pay back the pool
        // Calc amount owed
        uint256 amount0Owed = LowGasSafeMath.add(decoded.amount0, fee0);
        uint256 amount1Owed = LowGasSafeMath.add(decoded.amount1, fee1);
        emit debug('amountXOweds calculated');
        // Approve amounts to pool
        TransferHelper.safeApprove(token0, address(this), amount0Owed);
        TransferHelper.safeApprove(token1, address(this), amount1Owed);
        // Have pool retrieve tokens
        if (amount0Owed>0) pay(token0, address(this), msg.sender, amount0Owed); // Contract pays pool
        if (amount1Owed>0) pay(token1, address(this), msg.sender, amount1Owed);
        emit debug('amountXOweds payed');

        // Retrieve profits!
        if (amountOut0>amount0Owed) {
            uint256 profit0 = LowGasSafeMath.sub(amountOut0, amount0Owed);
            TransferHelper.safeApprove(token0, address(this), profit0);
            pay(token0, address(this), decoded.payer, profit0); // Contract pays user
        }
        if (amountOut1>amount1Owed) {
            uint256 profit1 = LowGasSafeMath.sub(amountOut1, amount1Owed);
            TransferHelper.safeApprove(token1, address(this), profit1);
            pay(token1, address(this), decoded.payer, profit1);
        }
        emit debug('Profits retrieved!');
    }
}