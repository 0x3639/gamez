// Change the live machine's bet limits without a redeploy (owner only).
// Usage: MIN_BET=0.1 MAX_BET_CAP=10 npx hardhat run scripts/set-limits.js --network zvmDevnet
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, requireDevnet } = require("./lib/devnet");

async function main() {
  await requireDevnet(ethers.provider);
  const [owner] = await ethers.getSigners();
  const d = readDeployment();
  const slot = await ethers.getContractAt("SlotMachine", d.address, owner);
  const minBet = ethers.parseEther(process.env.MIN_BET ?? ethers.formatEther(await slot.minBet()));
  const cap = ethers.parseEther(process.env.MAX_BET_CAP ?? ethers.formatEther(await slot.maxBetCap()));
  const bankroll = await slot.bankroll();
  if (cap * 40n > bankroll) console.warn(`warning: cap ${ethers.formatEther(cap)} needs ${ethers.formatEther(cap * 40n)} ZNN of bankroll to bind; bankroll is ${ethers.formatEther(bankroll)}`);
  await (await slot.setLimits(minBet, cap)).wait(1);
  console.log(`limits: min ${ethers.formatEther(await slot.minBet())} ZNN, cap ${ethers.formatEther(await slot.maxBetCap())} ZNN, effective maxBet ${ethers.formatEther(await slot.maxBet())} ZNN`);
  console.log(`${DEVNET.explorer}/address/${d.address}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
