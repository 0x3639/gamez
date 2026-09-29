// Places one 0.1 wZNN bet from the deployer, waits for the target block, settles, prints reels.
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, sleep, WETH_ABI } = require("./lib/devnet");

async function main() {
  const [signer] = await ethers.getSigners();
  const d = readDeployment();
  const weth = new ethers.Contract(DEVNET.wrappedZnn, WETH_ABI, signer);
  const slot = await ethers.getContractAt("SlotMachine", d.address, signer);
  const bet = ethers.parseEther("0.1");
  if ((await weth.balanceOf(signer.address)) < bet) await (await weth.deposit({ value: bet })).wait(1);
  if ((await weth.allowance(signer.address, d.address)) < bet) await (await weth.approve(d.address, ethers.MaxUint256)).wait(1);

  const rc = await (await slot.placeBet(bet)).wait(1);
  const placed = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === "SpinPlaced");
  const id = placed.args.id, target = Number(placed.args.targetBlock);
  console.log(`placed spin ${id} in block ${rc.blockNumber}, target ${target}: ${DEVNET.explorer}/tx/${rc.hash}`);
  while ((await ethers.provider.getBlockNumber()) <= target) { await sleep(2000); process.stdout.write("."); }
  console.log();
  const rc2 = await (await slot.settle(id)).wait(1);
  const ev = rc2.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && (p.name === "SpinSettled" || p.name === "SpinExpired"));
  console.log(`${ev.name}:`, ev.name === "SpinSettled"
    ? `reels ${ev.args.r0} ${ev.args.r1} ${ev.args.r2}, payout ${ethers.formatEther(ev.args.payout)} wZNN`
    : "expired");
  console.log(`${DEVNET.explorer}/tx/${rc2.hash}`);
  const blk = await ethers.provider.getBlock(target);
  const check = await slot.reelsFor(blk.hash, id);
  console.log(`reelsFor(blockhash) = ${check.join(" ")} (must match)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
