// Pause an old SlotMachine deployment and withdraw its unreserved bankroll to the owner.
// Usage: OLD_ADDRESS=0x… npx hardhat run scripts/retire.js --network zvmDevnet
const { ethers } = require("hardhat");
const { DEVNET, requireDevnet } = require("./lib/devnet");

async function main() {
  await requireDevnet(ethers.provider);
  const [owner] = await ethers.getSigners();
  const address = process.env.OLD_ADDRESS;
  if (!address) throw new Error("set OLD_ADDRESS");
  const slot = await ethers.getContractAt("SlotMachine", address, owner);
  if ((await slot.owner()).toLowerCase() !== owner.address.toLowerCase()) throw new Error("signer is not the owner");
  if (!(await slot.paused())) { await (await slot.pause()).wait(1); console.log("paused"); }
  const unlocked = await slot.unlockedBalance();
  const locked = await slot.locked();
  if (unlocked > 0n) { await (await slot.withdraw(unlocked)).wait(1); }
  console.log(`withdrew ${ethers.formatEther(unlocked)} wZNN (still reserved for open spins: ${ethers.formatEther(locked)})`);
  console.log(`${DEVNET.explorer}/address/${address}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
