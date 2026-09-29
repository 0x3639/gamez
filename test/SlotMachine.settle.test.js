const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup(TokenName = "MockWETH") {
  const [owner, alice, bob] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory(TokenName)).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(slotAddr, E(100));
  await tok.mint(alice.address, E(10));
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, bob, tok, slot, slotAddr };
}

async function place(slot, signer, amount) {
  const rc = await (await slot.connect(signer).placeBet(amount)).wait();
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
      p = slot.connect(alice).placeBet(E(1));
      s = slot.connect(alice).settle(1n);
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
    const { alice, tok, slot, slotAddr } = await setup();
    const { id, targetBlock } = await place(slot, alice, E(1));
    await mine(2); // eth_call sees block.number == head, so head must be past the target for canSettle
    expect(await slot.canSettle(id)).to.equal(true);
    const rc = await (await slot.connect(alice).settle(id)).wait();
    const ev = settledEvent(slot, rc);
    expect(ev.name).to.equal("SpinSettled");
    const { r0, r1, r2, payout } = ev.args;
    const want = E(1) * (await slot.multiplierX10(r0, r1, r2)) / 10n;
    expect(payout).to.equal(want);
    // reels match the pure function applied to the real target block hash
    const blk = await ethers.provider.getBlock(Number(targetBlock));
    const reels = await slot.reelsFor(blk.hash, id);
    expect([r0, r1, r2]).to.deep.equal([...reels]);
    expect(await tok.balanceOf(alice.address)).to.equal(E(9) + payout);
    expect(await tok.balanceOf(slotAddr)).to.equal(E(101) - payout);
    expect(await slot.locked()).to.equal(0n);
    expect((await slot.spins(id)).settled).to.equal(true);
    await expect(slot.settle(id)).to.be.revertedWithCustomError(slot, "AlreadySettled");
  });

  it("can be settled by anyone; payout still goes to the player", async () => {
    const { alice, bob, tok, slot } = await setup();
    const { id } = await place(slot, alice, E(1));
    await mine(1);
    const rc = await (await slot.connect(bob).settle(id)).wait();
    const { payout } = settledEvent(slot, rc).args;
    expect(await tok.balanceOf(alice.address)).to.equal(E(9) + payout);
    expect(await tok.balanceOf(bob.address)).to.equal(0n);
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
    const { alice, tok, slot, slotAddr } = await setup();
    const { id } = await place(slot, alice, E(1));
    await mine(257);
    await expect(slot.settle(id)).to.emit(slot, "SpinExpired").withArgs(id, alice.address, E(1));
    expect(await tok.balanceOf(alice.address)).to.equal(E(9));
    expect(await tok.balanceOf(slotAddr)).to.equal(E(101));
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
      for (let i = 0; i < 5; i++) txs.push(slot.connect(alice).placeBet(E(0.5)));
      await mine(1);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
    await Promise.all(txs);
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

  it("blocks re-entrant settle and placeBet from inside the token transfers (only the guard can stop them)", async () => {
    const { alice, tok, slot, slotAddr } = await setup("ReentrantToken");
    const guardSelector = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

    // Spin A: keep placing until one pays, so settle(A) makes a payout transfer (the re-entry point).
    let idA, targetBlock;
    for (let i = 0; i < 40; i++) {
      ({ id: idA, targetBlock } = await place(slot, alice, E(0.1)));
      await mine(1);
      const blk = await ethers.provider.getBlock(Number(targetBlock));
      const [a, b, c] = await slot.reelsFor(blk.hash, idA);
      if ((await slot.multiplierX10(a, b, c)) > 0n) break;
      await slot.settle(idA);
    }
    // Spin B: unsettled and already settleable, so a re-entrant settle(B) would succeed without the guard.
    const { id: idB } = await place(slot, alice, E(0.1));
    await mine(2); // eth_call sees block.number == head, so head must be past B's target for canSettle
    expect(await slot.canSettle(idB)).to.equal(true);

    await tok.arm(slotAddr, slot.interface.encodeFunctionData("settle", [idB]));
    await expect(slot.settle(idA)).to.emit(slot, "SpinSettled");
    expect(await tok.reentryAttempts()).to.equal(1n);
    expect(await tok.lastReentryOk()).to.equal(false);
    expect(await tok.lastReentryData()).to.equal(guardSelector);
    expect((await slot.spins(idB)).settled).to.equal(false);

    await tok.disarm();
    await expect(slot.settle(idB)).to.emit(slot, "SpinSettled");
    expect((await slot.spins(idB)).settled).to.equal(true);

    // placeBet re-entered from inside placeBet's own transferFrom. The token holds funds and an
    // allowance toward the slot machine, so without the guard the inner placeBet would succeed.
    const tokAddr = await tok.getAddress();
    await tok.mint(tokAddr, E(1));
    await tok.selfApprove(slotAddr);
    await tok.arm(slotAddr, slot.interface.encodeFunctionData("placeBet", [E(0.1)]));
    const before = await slot.nextSpinId();
    await slot.connect(alice).placeBet(E(0.1));
    expect(await slot.nextSpinId()).to.equal(before + 1n); // exactly one spin created
    expect(await tok.reentryAttempts()).to.equal(2n);
    expect(await tok.lastReentryOk()).to.equal(false);
    expect(await tok.lastReentryData()).to.equal(guardSelector);
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
