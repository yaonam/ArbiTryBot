require('dotenv').config();
require("@nomiclabs/hardhat-waffle");

const PRIVATE_KEY = process.env.PRIVATE_KEY;

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.7.6",
      },
      {
        version: "0.8.0",
        settings: {},
      },
    ],
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-rinkeby.alchemyapi.io/v2/jhOVe7vIcOktbFb2R7NH6db336E_Guhf`,
        accounts: [`${PRIVATE_KEY}`],
      }
    },
    ropsten: {
      url: `https://eth-ropsten.alchemyapi.io/v2/${process.env.ROPSTEN_URL}`,
      accounts: [`${PRIVATE_KEY}`],
    },
    rinkeby: {
      url: `https://eth-rinkeby.alchemyapi.io/v2/jhOVe7vIcOktbFb2R7NH6db336E_Guhf`,
      accounts: [`${PRIVATE_KEY}`],
    }
  }
};