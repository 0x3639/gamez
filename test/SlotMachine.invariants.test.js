const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseEther(String(n));

// Deterministic PRNG so a failure is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe("SlotMachine invariants (randomized)", () => {
  it("locked <= balance, payouts <= 40x, reservations always released", async function () {
    this.timeout(600000);
    const rand = rng(20260929);
    const [owner, ...players] = (await ethers.getSigners()).slice(0, 5);
    const tok = await (await ethers.getContractFactory("MockWETH")).deploy();
    const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
      await tok.getAddress(), owner.address, E(0.1), E(5));
    const slotAddr = await slot.getAddress();
    await tok.mint(owner.address, E(1000));
    await tok.connect(owner).approve(slotAddr, ethers.MaxUint256);
    await slot.connect(owner).fund(E(200));
    for (const p of players) {
      await tok.mint(p.address, E(100));
      await tok.connect(p).approve(slotAddr, ethers.MaxUint256);
    }

    const open = [];
    let totalPaid = 0n, totalBet = 0n;
    for (let step = 0; step < 300; step++) {
      const r = rand();
      if (r < 0.5) {
        const p = players[Math.floor(rand() * players.length)];
        const max = await slot.maxBet();
        if (max >= E(0.1)) {
          const amt = E(0.1) + BigInt(Math.floor(rand() * Number((max - E(0.1)) / 10n ** 15n))) * 10n ** 15n;
          const rc = await (await slot.connect(p).placeBet(amt)).wait();
          const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
            .find((x) => x && x.name === "SpinPlaced");
          open.push({ id: ev.args.id, amount: ev.args.amount });
          totalBet += ev.args.amount;
        }
      } else if (r < 0.85 && open.length) {
        const i = Math.floor(rand() * open.length);
        const { id, amount } = open.splice(i, 1)[0];
        if (!(await slot.canSettle(id))) await mine(1);
        const rc = await (await slot.settle(id)).wait();
        const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
          .find((x) => x && (x.name === "SpinSettled" || x.name === "SpinExpired"));
        if (ev.name === "SpinSettled") {
          expect(ev.args.payout).to.be.at.most(amount * 40n);
          totalPaid += ev.args.payout;
        }
      } else if (r < 0.95) {
        const unlocked = await slot.unlockedBalance();
        if (unlocked > 0n) await slot.connect(owner).withdraw(unlocked / 3n);
      } else {
        await slot.connect(owner).fund(E(10));
      }
      const bal = await tok.balanceOf(slotAddr);
      expect(await slot.locked()).to.be.at.most(bal);
      expect(await slot.unlockedBalance()).to.equal(bal - (await slot.locked()));
    }
    for (const { id } of open) {
      if (!(await slot.canSettle(id))) await mine(1);
      await slot.settle(id);
    }
    expect(await slot.locked()).to.equal(0n);
    expect(totalPaid).to.be.at.most(totalBet * 40n);
  });
});
