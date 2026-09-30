const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");

async function deploy() {
  const [owner] = await ethers.getSigners();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(owner.address, MIN, CAP);
  return { owner, slot };
}

describe("SlotMachine paytable and views", () => {
  it("maps every reel combination to the spec multiplier", async () => {
    const { slot } = await deploy();
    let total = 0n;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
      const m = await slot.multiplierX10(a, b, c);
      let want;
      if (a === b && b === c) want = a === 5 ? 400n : a === 4 ? 200n : 80n;
      else if (a === b || b === c || a === c) want = 12n;
      else want = 0n;
      expect(m, `${a}${b}${c}`).to.equal(want);
      total += m;
    }
    // RTP = 2000 / (216 * 10) = 92.59%
    expect(total).to.equal(2000n);
  });

  it("derives reels only from the block hash and id, each in 0..5", async () => {
    const { slot } = await deploy();
    const h = ethers.keccak256(ethers.toUtf8Bytes("block"));
    const [r0, r1, r2] = await slot.reelsFor(h, 1n);
    for (const r of [r0, r1, r2]) expect(r).to.be.lessThan(6n);
    const again = await slot.reelsFor(h, 1n);
    expect(again).to.deep.equal([r0, r1, r2]);
    const other = await slot.reelsFor(h, 2n);
    expect(other).to.not.deep.equal([r0, r1, r2]); // ids differ -> outcomes differ (overwhelmingly)
  });

  it("exposes constants and constructor state", async () => {
    const { slot, owner } = await deploy();
    expect(await slot.MAX_MULTIPLIER()).to.equal(40n);
    expect(await slot.SYMBOLS()).to.equal(6n);
    expect(await slot.SYMBOL_SEVEN()).to.equal(4n);
    expect(await slot.SYMBOL_Z()).to.equal(5n);
    expect(await slot.owner()).to.equal(owner.address);
    expect(await slot.minBet()).to.equal(MIN);
    expect(await slot.maxBetCap()).to.equal(CAP);
    expect(await slot.nextSpinId()).to.equal(1n);
    expect(await slot.locked()).to.equal(0n);
  });

  it("rejects bad constructor args", async () => {
    const [owner] = await ethers.getSigners();
    const F = await ethers.getContractFactory("SlotMachine");
    await expect(F.deploy(owner.address, 0n, CAP)).to.be.revertedWithCustomError(F, "BadLimits");
    await expect(F.deploy(owner.address, CAP + 1n, CAP)).to.be.revertedWithCustomError(F, "BadLimits");
  });

  it("maxBet is min(cap, unlocked/40) and 0 with an empty bankroll; plain sends and fund() top up", async () => {
    const { slot, owner } = await deploy();
    expect(await slot.maxBet()).to.equal(0n);
    await owner.sendTransaction({ to: await slot.getAddress(), value: ethers.parseEther("40") });
    expect(await slot.maxBet()).to.equal(ethers.parseEther("1"));
    expect(await slot.bankroll()).to.equal(ethers.parseEther("40"));
    expect(await slot.unlockedBalance()).to.equal(ethers.parseEther("40"));
    await expect(slot.fund({ value: ethers.parseEther("400") })).to.emit(slot, "Funded").withArgs(owner.address, ethers.parseEther("400"));
    expect(await slot.maxBet()).to.equal(CAP);
  });

  it("canSettle is false for unknown ids", async () => {
    const { slot } = await deploy();
    expect(await slot.canSettle(0n)).to.equal(false);
    expect(await slot.canSettle(1n)).to.equal(false);
  });
});
