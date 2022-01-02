const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
  
    console.log("Deploying contracts with the account:", deployer.address);  
    console.log("Account balance:", (await deployer.getBalance()).toString());
  
    const contractName = "PairFlash";
    const addressFactory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    const addressRouter = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    const addressWETH = '0xc778417e063141139fce010982780140aa0cd5ab';

    const Contract = await ethers.getContractFactory(contractName);
    const overrides = {
        // gasPrice: Number(1000000000), // One Gwei
        // nonce: 2
    }
    const contract = await Contract.deploy(addressRouter,addressFactory,addressWETH,overrides);
  
    console.log(contractName, " address:", contract.address);
  }
  
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });