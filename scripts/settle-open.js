// Keeper: settles every settleable spin among the most recent 400 ids, so an attacker
// cannot hold bankroll capacity by leaving a bet unsettled. Safe to run from cron.
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, requireDevnet } = require("./lib/devnet");

async function main() {
  await requireDevnet(ethers.provider);
  const [signer] = await ethers.getSigners();
  const d = readDeployment();
  const slot = await ethers.getContractAt("SlotMachine", d.address, signer);
  const next = await slot.nextSpinId();
  const last = next - 1n;
  const first = next > 400n ? next - 400n : 1n;
  console.log(`scanning spins #${first}..#${last}`);
  let settled = 0;
  for (let id = first; id <= last; id++) {
    const s = await slot.spins(id);
    if (s.settled) continue;
    if (!(await slot.canSettle(id))) continue;
    const rc = await (await slot.settle(id)).wait(1);
    const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && (p.name === "SpinSettled" || p.name === "SpinExpired"));
    if (!ev) throw new Error(`no SpinSettled/SpinExpired event for #${id} in tx ${rc.hash}`);
    console.log(ev.name === "SpinSettled"
      ? `settled #${id} → SpinSettled reels ${ev.args.r0} ${ev.args.r1} ${ev.args.r2} payout ${ethers.formatEther(ev.args.payout)}`
      : `settled #${id} → SpinExpired`, `${DEVNET.explorer}/tx/${rc.hash}`);
    settled++;
  }
  console.log(`done: ${settled} spin(s) settled`);
}

main().catch((e) => { console.error(e); process.exit(1); });
