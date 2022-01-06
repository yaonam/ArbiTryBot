require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY;
const flashSwapAddress = process.env.FLASH_SWAP;

import { BigNumber, ethers } from "ethers";
import { Pool, Route, Trade } from "@uniswap/v3-sdk";
import { CurrencyAmount, Token, TradeType } from "@uniswap/sdk-core";
// Pool abi
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
// Quoter abi
import { abi as QuoterABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
// Contract abi
import { abi as PairSwapABI } from "../artifacts/contracts/flash-swap.sol/PairSwap.json";
import { JsonRpcBatchProvider } from "@ethersproject/providers";
// import JSBI from "../node_modules/jsbi/jsbi";
import JSBI from "@uniswap/sdk-core/node_modules/jsbi"
import { BigintIsh } from '@uniswap/sdk-core';

const provider = ethers.getDefaultProvider('http://localhost:8545');//new ethers.providers.AlchemyProvider('rinkeby',process.env.RINKEBY_URL);

// Create quoter contract abstraction
const quoterAddress = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const quoterContract = new ethers.Contract(quoterAddress, QuoterABI, provider);

// Create pool var to hold addr pairs to compare prices
    // 1% Token holder: 0x63e64a5d51ec5c065047a71bb69adc8a318a2727
    // 0.3% Token holder: 0x88f3265ae26e0efe50f20b6a2a02bb0dd1ee8b4e
    // BlockBiz Token: 0x92F57C4b19D1946d746Df6D00C137781506E8619
    // WETH Token: 0xc778417E063141139Fce010982780140Aa0cD5Ab
const poolPairs = [['0x63e64a5d51ec5c065047a71bb69adc8a318a2727','0x88f3265ae26e0efe50f20b6a2a02bb0dd1ee8b4e',]];

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

let poolAddrA, poolAddrB;
let poolContractA, poolContractB;
let tokenA0, tokenA1, tokenB0, tokenB1;
let token0, token1;
let slot0A, slot0B;
let liquidityA, liquidityB;

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
async function getPoolState(poolContract: ethers.Contract) {
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

// Use quoter to check for profitability
async function isProfitable (amntInA) {
    // Set arbitrary amount in
    const [feeA, feeB] = await Promise.all([poolContractA.fee(), poolContractB.fee()]);
    const qAmntOutB = await quoterContract.callStatic.quoteExactInputSingle(tokenA0, tokenA1, feeA, amntInA, 0);
    const qAmntOutA = await quoterContract.callStatic.quoteExactInputSingle(tokenB1, tokenB0, feeB, qAmntOutB, 0);
    return (Math.abs(qAmntOutA-Number('0x42ad')) > 1 && qAmntOutA > amntInA);
}

// Compare prices in pools to see if there's an opp
// Args: Pair of pool addrs in an array
async function checkPrices(poolPair: [string, string]) {
    console.log('Checking prices...');
    [poolAddrA, poolAddrB] = poolPair;
    poolContractA = new ethers.Contract(poolAddrA,IUniswapV3PoolABI,provider);
    poolContractB = new ethers.Contract(poolAddrB,IUniswapV3PoolABI,provider);
    [tokenA0, tokenA1, tokenB0, tokenB1] = await Promise.all([poolContractA.token0(),poolContractA.token1(),poolContractB.token0(),poolContractB.token1()]);
    
    if (await isProfitable(150)) {
      console.log('Opportunity found!')
      executeSwap();
    }
}

// Calculate max amount of token0 to arbitrage using binary search
async function calcAmountIn() {
    let counter = 0;
    let [small, big] = [50, 500];
    while (counter < 17) {
      let medium = Math.round((big+small)/2);
      console.log(small,medium,big);
      if (await isProfitable(medium)) {
        small = medium;
      } else {
        big = medium;
      }
      counter++;
    }
    console.log('Calculated optimum:',small);
    return small;
}

async function executeSwap() {
    console.log('Executing swap...');
    // ATTENTION!!!! NEED TO UPDATE ADDRESS IN ENV AFTER DEPLOYING FLASH-SWAP CONTRACT!!!!!!!--------------------------------------------
    const wallet = new ethers.Wallet(privateKey,provider);
    const flashSwapContract = new ethers.Contract(flashSwapAddress,PairSwapABI,wallet);

    console.log('Calculating optimum...')
    const optimum = await calcAmountIn();
    
    const swapParams = {
      token0: tokenA0, // BB, token to borrow
      token1: tokenA1, // WETH
      fee1: 3000, // Pool to borrow token0 from
      amount0: optimum, // Amount of token0 to borrow
      amount1: 0, // Amount of token1 to borrow
      fee2: 10000, // Pool to trade in token0 for token1
      sqrtPriceX96: ((await poolContractB.slot0())[0].div(100).mul(101)).toString(),
    };
    
    const overrides = {
      gasLimit: 3000000,
      gasPrice: Number(10000000), // 00 One Gwei
      // nonce: 0
    };

    console.log('Initiating swap with',swapParams.amount0,'of',swapParams.token0);
    const tx = await flashSwapContract.initSwap(swapParams,overrides);
    console.log(tx);
    await tx.wait();
    console.log('Swap successful!');
}

const ArbiTryBot = async () => {
    console.log('Bot starting...')
    // Check prices for each pair
    provider.on('block', async (blockNumber) => {
      try {
        console.log(blockNumber);
        poolPairs.forEach(checkPrices);
      } catch (err) {
        console.error(err);
      }
    });
};

ArbiTryBot();
// poolPairs.forEach(checkPrices);