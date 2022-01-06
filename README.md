# ArbiTryBot

ArbiTryBot is a arbitrage bot built for Uniswap V3 Pools. It uses the flash swap() method to execute the arbitrage with no upfront capital (other than gas fees). 

### Rinkeby Testnet Deployment

PairSwap Address: 0x655ba030a8EfaD19309dCB9f5193Ad42c2ABBBA8

PairFlash Address: 0xD7A7f3C4FEf0E556A772a18B947C807D302844Da

PairFlashTest Address: 0xF24aD4587C2411cE6854a9182F2D161373B3E14C

SwapExamples Address: 0xFb14FCEf1406AD16081F24D38f0824DE48A44450

## Development

// To create/use fork

```
npx hardhat node (--fork URL)
npx hardhat console --network localhost
npx hardhat run script.js --network localhost
```