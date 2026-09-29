require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const DEVNET_RPC = "https://devnet.zenon.foo/zvm/rpc";
const DEVNET_CHAIN_ID = 7340469;
const key = process.env.DEPLOYER_PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    zvmDevnet: {
      url: DEVNET_RPC,
      chainId: DEVNET_CHAIN_ID,
      // devnet relayer requires >= 50 gwei priority fee; real txs use 100 gwei
      gasPrice: 100_001_000_000,
      accounts: key ? [key] : [],
    },
  },
  mocha: { timeout: 120000 },
};
