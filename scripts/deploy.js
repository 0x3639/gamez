const { ethers, network } = require("hardhat");
const { DEVNET, writeDeployment } = require("./lib/devnet");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY not set in .env");
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network ${network.name} chain ${(await ethers.provider.getNetwork()).chainId}`);
  console.log(`deployer ${deployer.address} balance ${ethers.formatEther(bal)} ZNN`);
  if (bal < ethers.parseEther("0.5")) throw new Error("deployer needs at least 0.5 ZNN for gas; run fund.js --faucet-only first");

  const F = await ethers.getContractFactory("SlotMachine");
  const args = [DEVNET.wrappedZnn, deployer.address, DEVNET.minBet, DEVNET.maxBetCap];
  const slot = await F.deploy(...args);
  const tx = slot.deploymentTransaction();
  console.log(`deploy tx ${tx.hash}`);
  const rc = await tx.wait(1);
  const address = await slot.getAddress();
  const constructorArgs = F.interface.encodeDeploy(args);
  writeDeployment({
    chainId: DEVNET.chainId, address, token: DEVNET.wrappedZnn, owner: deployer.address,
    deployBlock: rc.blockNumber, constructorArgs, txHash: tx.hash,
  });
  console.log(`SlotMachine at ${address} (block ${rc.blockNumber})`);
  console.log(`${DEVNET.explorer}/address/${address}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
