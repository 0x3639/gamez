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
  return { owner, alice, bob, slot, slotAddr };
}
const bal = (a) => ethers.provider.getBalance(a);

describe("SlotMachine owner functions", () => {
  it("fund and plain sends add ZNN from anyone and emit", async () => {
    const { owner, alice, slot, slotAddr } = await setup();
    await expect(slot.connect(owner).fund({ value: E(50) })).to.emit(slot, "Funded").withArgs(owner.address, E(50));
    await expect(alice.sendTransaction({ to: slotAddr, value: E(1) })).to.emit(slot, "Funded").withArgs(alice.address, E(1));
    expect(await bal(slotAddr)).to.equal(E(51));
  });

  it("withdraw is owner-only and capped by the unlocked balance", async () => {
    const { owner, alice, slot } = await setup();
    await slot.connect(owner).fund({ value: E(50) });
    await slot.connect(alice).placeBet({ value: E(1) });               // locked 40, balance 51
    await expect(slot.connect(alice).withdraw(E(1))).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
    await expect(slot.connect(owner).withdraw(E(11) + 1n)).to.be.revertedWithCustomError(slot, "InsufficientUnlocked");
    const before = await bal(owner.address);
    const rc = await (await slot.connect(owner).withdraw(E(11))).wait();
    expect((await bal(owner.address)) - before + rc.gasUsed * rc.gasPrice).to.equal(E(11));
    await mine(1);
    await slot.settle(1n);
    expect(await slot.locked()).to.equal(0n);
  });

  it("setLimits validates and emits", async () => {
    const { owner, alice, slot } = await setup();
    await expect(slot.connect(alice).setLimits(E(1), E(2))).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
    await expect(slot.connect(owner).setLimits(0n, E(2))).to.be.revertedWithCustomError(slot, "BadLimits");
    await expect(slot.connect(owner).setLimits(E(3), E(2))).to.be.revertedWithCustomError(slot, "BadLimits");
    await expect(slot.connect(owner).setLimits(E(1), 2n ** 96n)).to.be.revertedWithCustomError(slot, "BadLimits");
    await expect(slot.connect(owner).setLimits(E(1), E(2))).to.emit(slot, "LimitsSet").withArgs(E(1), E(2));
    expect(await slot.minBet()).to.equal(E(1));
    expect(await slot.maxBetCap()).to.equal(E(2));
  });

  it("ownership is two-step and cannot be renounced", async () => {
    const { owner, bob, slot } = await setup();
    await slot.connect(owner).transferOwnership(bob.address);
    expect(await slot.owner()).to.equal(owner.address);
    expect(await slot.pendingOwner()).to.equal(bob.address);
    await slot.connect(bob).acceptOwnership();
    expect(await slot.owner()).to.equal(bob.address);
    await expect(slot.connect(bob).renounceOwnership()).to.be.revertedWithCustomError(slot, "RenounceDisabled");
    await expect(slot.connect(owner).pause()).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
  });
});
