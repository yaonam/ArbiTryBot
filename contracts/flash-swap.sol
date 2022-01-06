// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.0;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol';
import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';

import '@uniswap/v3-periphery/contracts/base/PeripheryPayments.sol';
import '@uniswap/v3-periphery/contracts/base/PeripheryImmutableState.sol';
import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/libraries/CallbackValidation.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';

// For debugging
// import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// import "hardhat/console.sol";

contract PairSwap is IUniswapV3SwapCallback, PeripheryPayments {
    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;

    ISwapRouter public immutable swapRouter;

    struct SwapParams {
        address token0;
        address token1;
        uint24 fee1; // Use to calc poolKey, borrow fee
        uint256 amount0; // Amount of token0 to borrow
        uint256 amount1; // Amount of token1 to borrow
        uint24 fee2; // Pass on to callback, first swap
        uint160 sqrtPriceX96;
    }

    struct SwapCallbackData {
        uint256 amount0;
        uint256 amount1;
        address payer;
        PoolAddress.PoolKey poolKey;
        uint24 poolFee2;
    }

    constructor(ISwapRouter _swapRouter, address _factory, address _WETH9) PeripheryImmutableState(_factory, _WETH9) {
        swapRouter = _swapRouter;
    }

    function initSwap(SwapParams memory params) external {
        // console.log('Started initSwap');
        // Get the poolKey, just like my own motions key
        PoolAddress.PoolKey memory poolKey =
            PoolAddress.PoolKey({token0: params.token0, token1: params.token1, fee: params.fee1});

        // Instantiate the pool object, just like my motions
        IUniswapV3Pool pool = IUniswapV3Pool(address(0x88f3265AE26e0eFe50F20b6a2a02BB0DD1ee8b4e)); //PoolAddress.computeAddress(factory, poolKey));
        // console.log('Pool address: ',address(pool));



        // Call flash to take out loan, will then call uniswapV3SwapCallback passing in data,
        // loan has to be paid back at end
        // console.log(params.amount0,params.sqrtPriceX96,params.fee2);
        pool.swap(
            address(this),
            false, // zeroForOne, bool, swap token0 for token1?
            int256(-params.amount0), // pos: exactInput, neg: exactOutput
            params.sqrtPriceX96, // sqrtPriceLimitX96: The Q64.96 sqrt price limit. If zero for one, the price cannot be less than this value after the swap. If one for zero, the price cannot be greater than this value after the swap
            abi.encode(
                SwapCallbackData({
                    amount0: params.amount0,
                    amount1: params.amount1,
                    payer: msg.sender,
                    poolKey: poolKey,
                    poolFee2: params.fee2
                })
            )
        );
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        // console.log('Started callback');
        // Decode the data arg
        SwapCallbackData memory decoded = abi.decode(data, (SwapCallbackData));

        // Verify that call originated from genuine v3 pool
        // CallbackValidation.verifyCallback(factory, decoded.poolKey);

        // Approve router to spend token0
        address token0 = decoded.poolKey.token0;
        address token1 = decoded.poolKey.token1;
        TransferHelper.safeApprove(token0, address(swapRouter), decoded.amount0);

        uint256 amount1 = uint256(amount1Delta);

        // console.log('Amounts:',decoded.amount0,decoded.amount1);

        // console.log(amount0Delta>0,amount1Delta>0,amount1);
        // console.log('About to execute swap');

        // console.log('Tokens:', token0, token1);
        // console.log(ERC20(token0).balanceOf(address(this)), ERC20(token1).balanceOf(address(this)));
        // console.log('Fee2:',decoded.poolFee2);

        // Execute swap
        uint256 amountOut1 = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token0,
                tokenOut: token1,
                fee: decoded.poolFee2,
                recipient: address(this),
                deadline: block.timestamp + 200,
                amountIn: decoded.amount0,
                amountOutMinimum: amount1,
                sqrtPriceLimitX96: 0
            }));
        // console.log('Executed swaps');

        // Pay back the pool
        // Approve amounts to pool
        TransferHelper.safeApprove(token1, address(this), amount1);
        // Have pool retrieve tokens
        pay(token1, address(this), msg.sender, amount1); // Contract pays pool
        // console.log('Paid back pool plus fees');

        // Retrieve profits!
        uint256 profit1 = LowGasSafeMath.sub(amountOut1, amount1);
        TransferHelper.safeApprove(token1, address(this), profit1);
        pay(token1, address(this), decoded.payer, profit1); // Contract pays user
        // console.log('Retrieved',profit1,'tokens!');
    }
}