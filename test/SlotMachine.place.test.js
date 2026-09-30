const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup() {
  const [owner, alice] = await ethers.getSigners();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await slot.fund({ value: E(100) });        // bankroll -> maxBet = min(5, 2.5) = 2.5
  return { owner, alice, slot, slotAddr };
}
const bal = (a) => ethers.provider.getBalance(a);

describe("SlotMachine.placeBet", () => {
  it("takes the bet, reserves 40x, targets the next block and emits", async () => {
    const { alice, slot, slotAddr } = await setup();
    const before = await bal(alice.address);
    const tx = await slot.connect(alice).placeBet({ value: E(1) });
    const rc = await tx.wait();
    await expect(tx).to.emit(slot, "SpinPlaced").withArgs(1n, alice.address, E(1), BigInt(rc.blockNumber) + 1n);
    expect(await bal(slotAddr)).to.equal(E(101));
    expect(before - (await bal(alice.address))).to.equal(E(1) + rc.gasUsed * rc.gasPrice);
    expect(await slot.locked()).to.equal(E(40));
    expect(await slot.nextSpinId()).to.equal(2n);
    const s = await slot.spins(1n);
    expect(s.player).to.equal(alice.address);
    expect(s.amount).to.equal(E(1));
    expect(s.targetBlock).to.equal(BigInt(rc.blockNumber) + 1n);
    expect(s.settled).to.equal(false);
    expect(await slot.canSettle(1n)).to.equal(false); // target block not mined yet
  });

  it("rejects below min, above max (the sent value does not count as bankroll), and above the cap", async () => {
    const { alice, slot } = await setup();
    await expect(slot.connect(alice).placeBet({ value: MIN - 1n })).to.be.revertedWithCustomError(slot, "BetTooSmall");
    await expect(slot.connect(alice).placeBet({ value: E(2.5) + 1n })).to.be.revertedWithCustomError(slot, "BetTooLarge");
    await expect(slot.connect(alice).placeBet({ value: E(2.5) })).to.not.be.reverted;
    await expect(slot.connect(alice).placeBet({ value: 0n })).to.be.revertedWithCustomError(slot, "BetTooSmall");
  });

  it("the sent value cannot inflate its own limit", async () => {
    // bankroll 100 -> limit 2.5; a 5 ZNN bet would pass if msg.value were counted as bankroll (105/40 = 2.625... no: 100/40)
    const { alice, slot } = await setup();
    await expect(slot.connect(alice).placeBet({ value: E(2.6) })).to.be.revertedWithCustomError(slot, "BetTooLarge");
  });

  it("reservations shrink maxBet until settled", async () => {
    const { alice, slot } = await setup();
    expect(await slot.maxBet()).to.equal(E(2.5));
    await slot.connect(alice).placeBet({ value: E(2) }); // balance 102, locked 80 -> unlocked 22 -> 0.55
    expect(await slot.maxBet()).to.equal(E(0.55));
    await expect(slot.connect(alice).placeBet({ value: E(1) })).to.be.revertedWithCustomError(slot, "BetTooLarge");
  });

  it("is blocked while paused", async () => {
    const { owner, alice, slot } = await setup();
    await slot.connect(owner).pause();
    await expect(slot.connect(alice).placeBet({ value: E(1) })).to.be.revertedWithCustomError(slot, "EnforcedPause");
    await slot.connect(owner).unpause();
    await expect(slot.connect(alice).placeBet({ value: E(1) })).to.not.be.reverted;
  });
});
