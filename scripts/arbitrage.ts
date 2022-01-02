require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY;
const flashSwapAddress = process.env.FLASH_SWAP;

import { ethers} from "ethers";
import { Pool, Route, Trade } from "@uniswap/v3-sdk";
// import { CurrencyAmount, Token, TradeType } from "@uniswap/sdk-core";
// Pool abi
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
// Quoter abi
import { abi as QuoterABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
// PairFlash abi
import {abi as pairFlashABI} from "./abi/PairFlash.json";

const provider = new ethers.providers.AlchemyProvider('rinkeby',process.env.RINKEBY_URL);

// Create quoter contract abstraction
const quoterAddress = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const quoterContract = new ethers.Contract(quoterAddress, QuoterABI, provider);

// Set var interfaces
interface Immutables {
    factory: string;
    token0: string;
    token1: string;
    fee: number;
    tickSpacing: number;
    maxLiquidityPerTick: ethers.BigNumber;
  }
  
interface State {
  liquidity: ethers.BigNumber;
  sqrtPriceX96: ethers.BigNumber;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
}

// https://docs.uniswap.org/protocol/reference/core/interfaces/pool/IUniswapV3PoolImmutables
async function getPoolImmutables(poolContract: ethers.Contract) {
  const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] =
    await Promise.all([
      poolContract.factory(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.tickSpacing(),
      poolContract.maxLiquidityPerTick(),
    ]);
  
  const immutables: Immutables = {
    factory,
    token0,
    token1,
    fee,
    tickSpacing,
    maxLiquidityPerTick,
  };
  return immutables;
  }

// https://docs.uniswap.org/protocol/reference/core/interfaces/pool/IUniswapV3PoolState
async function getPoolState(poolContract) {
    const [liquidity, slot] = await Promise.all([
      poolContract.liquidity(),
      poolContract.slot0(),
    ]);
  
    const PoolState: State = {
      liquidity,
      sqrtPriceX96: slot[0],
      tick: slot[1],
      observationIndex: slot[2],
      observationCardinality: slot[3],
      observationCardinalityNext: slot[4],
      feeProtocol: slot[5],
      unlocked: slot[6],
    };
  
    return PoolState;
  }

async function main() {
  // 1% Token holder: 0x63e64a5d51ec5c065047a71bb69adc8a318a2727
  // 0.3% Token holder: 0x88f3265ae26e0efe50f20b6a2a02bb0dd1ee8b4e
  // BlockBiz Token: 0x92F57C4b19D1946d746Df6D00C137781506E8619
  // WETH Token: 0xc778417E063141139Fce010982780140Aa0cD5Ab
  
  const poolAddr1 = "0x63e64a5d51ec5c065047a71bb69adc8a318a2727"; // 1% Fee pool address
  const poolAddr03 = "0x88f3265ae26e0efe50f20b6a2a02bb0dd1ee8b4e"; // 0.3% Fee pool address
  // Create pool contract abstractions
  const poolContract1 = new ethers.Contract(poolAddr1,IUniswapV3PoolABI,provider);
  const poolContract03 = new ethers.Contract(poolAddr03,IUniswapV3PoolABI,provider);

    // Get immutables & states for each pool
    const [immtbls1, state1] = await Promise.all([getPoolImmutables(poolContract1),getPoolState(poolContract1),]);
    const [immtbls03, state03] = await Promise.all([getPoolImmutables(poolContract03),getPoolState(poolContract03),]);
    console.log('Token symmetry test: ');
    console.log('immtbls1.token0: ', immtbls1.token0);
    console.log('immtbls03.token0: ', immtbls03.token0);
    
    // Set arbitrary amount in
    const amntIn = 150;
    // Get quotes using callStatic
    const qAmntOut1 = await quoterContract.callStatic.quoteExactInputSingle(immtbls1.token0, immtbls1.token1, immtbls1.fee, amntIn.toString(), 0);
    const qAmntOut03 = await quoterContract.callStatic.quoteExactInputSingle(immtbls03.token1, immtbls03.token0, immtbls03.fee, qAmntOut1.toString(), 0);
    
    // Based on quotes, order pools
    const profitable = qAmntOut03>amntIn;
    // const TokenA = new Token(4, immtbls1.token0, 0, "BB", "BlockBiz");  
    // const TokenB = new Token(4, immtbls1.token1, 18, "WETH", "Wrapped Ether");
    console.log('Trading in BB to ', immtbls1.fee, 'fee pool, profitability is ', profitable);
    console.log('Amount in: ', amntIn);
    console.log('Amount out: ', qAmntOut03.toString());
    
    // const blah = await quoterContract.callStatic.quoteExactInputSingle(immtbls03.token0, immtbls03.token1, immtbls03.fee, amntIn.toString(), 0);
    // const bleh = await quoterContract.callStatic.quoteExactInputSingle(immtbls1.token1, immtbls1.token0, immtbls1.fee, blah.toString(), 0);
    // console.log('Reverse pool ordering is...:')
    // console.log('Amount in: ', amntIn);
    // console.log('Amount out: ', bleh.toString());

    // ATTENTION!!!! NEED TO UPDATE ADDRESS IN ENV AFTER DEPLOYING FLASH-SWAP CONTRACT!!!!!!!--------------------------------------------
    const wallet = new ethers.Wallet(privateKey, provider);
    const flashSwapContract = new ethers.Contract(flashSwapAddress,pairFlashABI,wallet);

    console.log('Calling initFlash with ', amntIn,' of BB and ', Math.round(qAmntOut1*1.1),' of WETH')
    const flashParams = {
      token0: ethers.utils.getAddress(immtbls1.token0), // BB
      token1: ethers.utils.getAddress(immtbls1.token1), // WETH
      fee1: 3000, // Pool to borrow from
      amount0: amntIn, // Amouont of token0 to borrow
      amount1: Math.round(qAmntOut1*1.1), // Amount of token1 to borrow
      fee2: 3000, // Trade in token1
      fee3: 10000, // Trade in token0
    };

    const overrides = {
      gasLimit: 3000000,
      // gasPrice: Number(1000000000), // One Gwei
      // nonce: 2
    }
    await flashSwapContract.initFlash(flashParams, overrides);


  
    // // Create pools
    // const pool1 = new Pool(TokenA, TokenB, immtbls1.fee, state1.sqrtPriceX96.toString(), state1.liquidity.toString(), state1.tick);
    // const pool03 = new Pool(TokenA, TokenB, immtbls03.fee, state03.sqrtPriceX96.toString(), state03.liquidity.toString(), state03.tick);

    // // Create swap route, like path?
    // const swapRoute = new Route([pool1,pool03], TokenA, TokenA);
    // // Create Unchecked Trade, good for when already have quote
    // const uncheckedTrade = await Trade.createUncheckedTrade({
    //   route: swapRoute,
    //   inputAmount: CurrencyAmount.fromRawAmount(TokenA, amntIn.toString()),
    //   outputAmount: CurrencyAmount.fromRawAmount(TokenB, qAmntOut03.toString()),
    //   tradeType: TradeType.EXACT_INPUT,
    // });
  }
  
  main();