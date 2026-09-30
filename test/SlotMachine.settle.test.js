const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup() {
  const [owner, alice, bob] = await ethers.getSigners();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await slot.fund({ value: E(100) });
  return { owner, alice, bob, slot, slotAddr };
}
const bal = (a) => ethers.provider.getBalance(a);

async function place(slot, signer, amount) {
  const rc = await (await slot.connect(signer).placeBet({ value: amount })).wait();
  const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === "SpinPlaced");
  return { id: ev.args.id, targetBlock: ev.args.targetBlock };
}

function settledEvent(slot, rc) {
  return rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && (p.name === "SpinSettled" || p.name === "SpinExpired"));
}

describe("SlotMachine.settle", () => {
  it("reverts TooEarly in the placement block and in the target block", async () => {
    const { alice, slot } = await setup();
    // automine: placeBet is block N, target N+1. Disable automine to test the same-block case.
    let p, s;
    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      // Explicit gasLimit skips estimateGas, which would race the pending placeBet and reject early.
      // Sequential sends keep the nonce order (placeBet first); with automine off each resolves once queued.
      p = await slot.connect(alice).placeBet({ value: E(1), gasLimit: 500000n });
      s = await slot.connect(alice).settle(1n, { gasLimit: 500000n });
      await mine(1);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
    await p;
    // Same block as placement, mined right after placeBet. The tx was accepted and reverted when mined, so
    // revertedWithCustomError (which needs a rejected promise) cannot see it; pin the reason from the trace.
    await expect(s).to.be.reverted;
    const trace = await ethers.provider.send("debug_traceTransaction", [(await s).hash]);
    expect(trace.returnValue).to.equal(slot.interface.getError("TooEarly").selector);
    await expect(slot.settle(1n)).to.be.revertedWithCustomError(slot, "TooEarly"); // this tx mines in the target block
    expect(await slot.canSettle(1n)).to.equal(false);
  });

  it("settles after the target block, pays amount*multiplier/10, releases the reservation, emits", async () => {
    const { alice, bob, slot, slotAddr } = await setup();
    const { id, targetBlock } = await place(slot, alice, E(1));
    await mine(2); // eth_call sees block.number == head, so head must be past the target for canSettle
    expect(await slot.canSettle(id)).to.equal(true);
    const aliceBefore = await bal(alice.address);
    const rc = await (await slot.connect(bob).settle(id)).wait(); // bob pays gas so alice's delta is the payout
    const ev = settledEvent(slot, rc);
    expect(ev.name).to.equal("SpinSettled");
    expect((await bal(alice.address)) - aliceBefore).to.equal(ev.args.payout);
    const { r0, r1, r2, payout } = ev.args;
    const want = E(1) * (await slot.multiplierX10(r0, r1, r2)) / 10n;
    expect(payout).to.equal(want);
    // reels match the pure function applied to the real target block hash
    const blk = await ethers.provider.getBlock(Number(targetBlock));
    const reels = await slot.reelsFor(blk.hash, id);
    expect([r0, r1, r2]).to.deep.equal([...reels]);
    expect(await bal(slotAddr)).to.equal(E(101) - payout);
    void bob;
    expect(await slot.locked()).to.equal(0n);
    expect((await slot.spins(id)).settled).to.equal(true);
    await expect(slot.settle(id)).to.be.revertedWithCustomError(slot, "AlreadySettled");
  });

  it("can be settled by anyone; payout still goes to the player", async () => {
    const { alice, bob, slot } = await setup();
    const { id } = await place(slot, alice, E(1));
    await mine(1);
    const aliceBefore = await bal(alice.address);
    const bobBefore = await bal(bob.address);
    const rc = await (await slot.connect(bob).settle(id)).wait();
    const { payout } = settledEvent(slot, rc).args;
    expect((await bal(alice.address)) - aliceBefore).to.equal(payout);
    expect(bobBefore - (await bal(bob.address))).to.equal(rc.gasUsed * rc.gasPrice); // bob only paid gas
  });

  it("gives the same reels whichever later block settles it (no settle-block shopping)", async () => {
    const { alice, slot } = await setup();
    const { id, targetBlock } = await place(slot, alice, E(1));
    await mine(2); // eth_call sees block.number == head, so head must be past the target
    const early = await slot.settle.staticCall(id);          // simulate now
    const blk = await ethers.provider.getBlock(Number(targetBlock));
    const expected = await slot.reelsFor(blk.hash, id);
    await mine(50);
    const rc = await (await slot.settle(id)).wait();
    const { r0, r1, r2 } = settledEvent(slot, rc).args;
    expect([r0, r1, r2]).to.deep.equal([...expected]);
    void early;
  });

  it("forfeits an expired spin (target older than 256 blocks) and releases the reservation", async () => {
    const { alice, bob, slot, slotAddr } = await setup();
    const { id } = await place(slot, alice, E(1));
    await mine(257);
    const aliceBefore = await bal(alice.address);
    await expect(slot.connect(bob).settle(id)).to.emit(slot, "SpinExpired").withArgs(id, alice.address, E(1));
    expect(await bal(alice.address)).to.equal(aliceBefore); // no refund
    expect(await bal(slotAddr)).to.equal(E(101));
    expect(await slot.locked()).to.equal(0n);
    expect((await slot.spins(id)).settled).to.equal(true);
  });

  it("rejects unknown ids", async () => {
    const { slot } = await setup();
    await expect(slot.settle(0n)).to.be.revertedWithCustomError(slot, "UnknownSpin");
    await expect(slot.settle(99n)).to.be.revertedWithCustomError(slot, "UnknownSpin");
  });

  it("still settles while paused", async () => {
    const { owner, alice, slot } = await setup();
    const { id } = await place(slot, alice, E(1));
    await slot.connect(owner).pause();
    await mine(1);
    await expect(slot.settle(id)).to.emit(slot, "SpinSettled");
  });

  it("many spins in one block get independent outcomes and reservations", async () => {
    const { alice, slot } = await setup();
    const txs = [];
    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      // Explicit gasLimit skips estimateGas; wait until every tx is in the mempool before mining them together.
      for (let i = 0; i < 5; i++) txs.push(slot.connect(alice).placeBet({ value: E(0.5), gasLimit: 500000n }));
      await Promise.all(txs);
      await mine(1);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
    expect(await slot.locked()).to.equal(E(0.5) * 40n * 5n);
    await mine(1);
    const seen = new Set();
    for (let id = 1n; id <= 5n; id++) {
      const rc = await (await slot.settle(id)).wait();
      const { r0, r1, r2 } = settledEvent(slot, rc).args;
      seen.add(`${r0}${r1}${r2}`);
    }
    expect(seen.size).to.be.greaterThan(1);
    expect(await slot.locked()).to.equal(0n);
  });

  it("blocks re-entrant settle and placeBet from inside the payout transfer (only the guard can stop them)", async () => {
    const { owner, slot, slotAddr } = await setup();
    const guardSelector = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);
    const player = await (await ethers.getContractFactory("ReentrantPlayer")).deploy(slotAddr);
    await player.fundMe({ value: E(5) });

    // Spin A from the contract player: keep placing until one pays, so settle(A) pays the contract (the re-entry point).
    let idA, targetBlock;
    for (let i = 0; i < 40; i++) {
      const rc = await (await player.bet(E(0.1))).wait();
      const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "SpinPlaced");
      idA = ev.args.id; targetBlock = ev.args.targetBlock;
      await mine(1);
      const blk = await ethers.provider.getBlock(Number(targetBlock));
      const [a, b, c] = await slot.reelsFor(blk.hash, idA);
      if ((await slot.multiplierX10(a, b, c)) > 0n) break;
      await slot.settle(idA);
    }
    // Spin B: unsettled and already settleable, so a re-entrant settle(B) would succeed without the guard.
    const rcB = await (await player.bet(E(0.1))).wait();
    const idB = rcB.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "SpinPlaced").args.id;
    await mine(2);
    expect(await slot.canSettle(idB)).to.equal(true);

    // Pushed payouts carry a 30k gas stipend: too little for this hook to run, so the payout is
    // deferred and the hook never fires. That is the intended defence for pushes.
    await player.arm(slot.interface.encodeFunctionData("settle", [idB]));
    const playerAddr = await player.getAddress();
    await expect(slot.connect(owner).settle(idA)).to.emit(slot, "PayoutDeferred");
    expect(await player.attempts()).to.equal(0n);
    const owed = await slot.owed(playerAddr);
    expect(owed).to.be.greaterThan(0n);

    // The pull path (withdrawPayout) forwards all gas, so the hook runs and re-enters settle(B):
    // only the reentrancy guard can stop it, because B is settleable and unsettled.
    await expect(player.claim()).to.emit(slot, "PayoutClaimed").withArgs(playerAddr, owed);
    expect(await player.attempts()).to.equal(1n);
    expect(await player.lastOk()).to.equal(false);
    expect(await player.lastData()).to.equal(guardSelector);
    expect((await slot.spins(idB)).settled).to.equal(false);
    expect(await slot.owed(playerAddr)).to.equal(0n);

    // Re-enter placeBet (with a real 0.1 ZNN stake) from inside the pull payout: the player holds ZNN, so
    // without the guard the inner bet would be placed. Find a paying spin C so a payout is owed again.
    await player.disarm();
    await slot.connect(owner).settle(idB);
    let idC, targetC;
    for (let i = 0; i < 60; i++) {
      const rc = await (await player.bet(E(0.1))).wait();
      const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "SpinPlaced");
      idC = ev.args.id; targetC = ev.args.targetBlock;
      await mine(1);
      const blk = await ethers.provider.getBlock(Number(targetC));
      const [a, b, c] = await slot.reelsFor(blk.hash, idC);
      if ((await slot.multiplierX10(a, b, c)) > 0n) break;
      await slot.settle(idC);
    }
    await player.armWithValue(slot.interface.encodeFunctionData("placeBet", []), E(0.1));
    const before = await slot.nextSpinId();
    const rcC = await (await slot.connect(owner).settle(idC)).wait();
    const deferredC = rcC.logs.some((l) => { try { return slot.interface.parseLog(l)?.name === "PayoutDeferred"; } catch { return false; } });
    if (deferredC) {
      // The armed hook did not fit in the 30k push stipend; the pull path forwards full gas and the hook fires there.
      expect(await player.attempts()).to.equal(1n);
      await expect(player.claim()).to.emit(slot, "PayoutClaimed");
    }
    // Either way the hook has now run once more and only the guard stopped the inner placeBet.
    expect(await slot.nextSpinId()).to.equal(before); // no spin created by the re-entry
    expect(await player.attempts()).to.equal(2n);
    expect(await player.lastOk()).to.equal(false);
    expect(await player.lastData()).to.equal(guardSelector);
  });

  it("defers the payout when the player contract rejects ZNN, and lets it be claimed later", async () => {
    const { owner, slot, slotAddr } = await setup();
    const rr = await (await ethers.getContractFactory("RejectingReceiver")).deploy();
    await rr.setAccept(true);
    await rr.fundMe({ value: E(5) });
    const rrAddr = await rr.getAddress();
    // find a paying spin for the contract player
    let id, targetBlock, payout;
    for (let i = 0; i < 60; i++) {
      const rc = await (await rr.bet(slotAddr, E(0.1))).wait();
      const ev = rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "SpinPlaced");
      id = ev.args.id; targetBlock = ev.args.targetBlock;
      await mine(1);
      const blk = await ethers.provider.getBlock(Number(targetBlock));
      const [a, b, c] = await slot.reelsFor(blk.hash, id);
      const m = await slot.multiplierX10(a, b, c);
      if (m > 0n) { payout = (E(0.1) * m) / 10n; break; }
      await slot.settle(id);
    }
    await rr.setAccept(false);
    const lockedBefore = await slot.locked();
    await expect(slot.connect(owner).settle(id)).to.emit(slot, "PayoutDeferred").withArgs(rrAddr, payout);
    expect(await slot.owed(rrAddr)).to.equal(payout);
    expect(await slot.locked()).to.equal(lockedBefore - E(0.1) * 40n + payout); // reservation released, payout re-reserved
    expect(await slot.unlockedBalance()).to.equal((await bal(slotAddr)) - (await slot.locked()));
    await expect(rr.claim(slotAddr)).to.be.revertedWithCustomError(slot, "SendFailed"); // still rejecting
    await rr.setAccept(true);
    const before = await bal(rrAddr);
    await expect(rr.claim(slotAddr)).to.emit(slot, "PayoutClaimed").withArgs(rrAddr, payout);
    expect((await bal(rrAddr)) - before).to.equal(payout);
    expect(await slot.owed(rrAddr)).to.equal(0n);
    expect(await slot.locked()).to.equal(lockedBefore - E(0.1) * 40n);
    await expect(rr.claim(slotAddr)).to.be.revertedWithCustomError(slot, "NothingOwed");
  });

  it("reels can be recomputed off-chain from the block hash and id", async () => {
    const { slot } = await setup();
    const h = ethers.keccak256(ethers.toUtf8Bytes("fixed block hash"));
    for (const id of [1n, 2n, 77n]) {
      const seed = ethers.solidityPackedKeccak256(["bytes32", "uint256"], [h, id]);
      const reel = (i) => Number(BigInt(ethers.solidityPackedKeccak256(["bytes32", "uint8"], [seed, i])) % 6n);
      expect([...(await slot.reelsFor(h, id))].map(Number)).to.deep.equal([reel(0), reel(1), reel(2)]);
    }
  });
});
