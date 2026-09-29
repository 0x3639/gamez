// Places one 0.1 wZNN bet from the deployer, waits for the target block, settles, prints reels.
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, sleep, requireDevnet, WETH_ABI } = require("./lib/devnet");

async function main() {
  await requireDevnet(ethers.provider);
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
  if (!placed) throw new Error(`SpinPlaced event not found in tx ${rc.hash}`);
  const id = placed.args.id, target = Number(placed.args.targetBlock);
  console.log(`placed spin ${id} in block ${rc.blockNumber}, target ${target}: ${DEVNET.explorer}/tx/${rc.hash}`);
  let waited = 0;
  while ((await ethers.provider.getBlockNumber()) <= target) {
    if (++waited > 60) throw new Error(`target block ${target} never arrived`);
    await sleep(2000); process.stdout.write(".");
  }
  console.log();
  const rc2 = await (await slot.settle(id)).wait(1);
  const ev = rc2.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && (p.name === "SpinSettled" || p.name === "SpinExpired"));
  if (!ev) throw new Error(`SpinSettled/SpinExpired event not found in tx ${rc2.hash}`);
  console.log(`${ev.name}:`, ev.name === "SpinSettled"
    ? `reels ${ev.args.r0} ${ev.args.r1} ${ev.args.r2}, payout ${ethers.formatEther(ev.args.payout)} wZNN`
    : "expired");
  console.log(`${DEVNET.explorer}/tx/${rc2.hash}`);
  if (ev.name !== "SpinSettled") throw new Error(`spin ${id} expired instead of settling (tx ${rc2.hash})`);
  const blk = await ethers.provider.getBlock(target);
  const check = await slot.reelsFor(blk.hash, id);
  console.log(`reelsFor(blockhash) = ${check.join(" ")} (must match)`);
  const got = [ev.args.r0, ev.args.r1, ev.args.r2].map(Number);
  const want = [check[0], check[1], check[2]].map(Number);
  if (got.some((v, i) => v !== want[i])) {
    throw new Error(`reel mismatch: event ${got.join(" ")} vs reelsFor ${want.join(" ")}`);
  }
  console.log("reels match: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
