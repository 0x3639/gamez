const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup() {
  const [owner, alice, bob] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory("MockWETH")).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(owner.address, E(100));
  await tok.mint(alice.address, E(10));
  await tok.connect(owner).approve(slotAddr, ethers.MaxUint256);
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, bob, tok, slot, slotAddr };
}

describe("SlotMachine owner functions", () => {
  it("fund moves tokens in from anyone and emits", async () => {
    const { owner, alice, tok, slot, slotAddr } = await setup();
    await expect(slot.connect(owner).fund(E(50))).to.emit(slot, "Funded").withArgs(owner.address, E(50));
    await expect(slot.connect(alice).fund(E(1))).to.emit(slot, "Funded").withArgs(alice.address, E(1));
    expect(await tok.balanceOf(slotAddr)).to.equal(E(51));
  });

  it("withdraw is owner-only and capped by the unlocked balance", async () => {
    const { owner, alice, tok, slot } = await setup();
    await slot.connect(owner).fund(E(50));
    await slot.connect(alice).placeBet(E(1));                       // locked 40, balance 51
    await expect(slot.connect(alice).withdraw(E(1))).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
    await expect(slot.connect(owner).withdraw(E(11) + 1n)).to.be.revertedWithCustomError(slot, "InsufficientUnlocked");
    await expect(slot.connect(owner).withdraw(E(11))).to.emit(slot, "Withdrawn").withArgs(owner.address, E(11));
    expect(await tok.balanceOf(owner.address)).to.equal(E(61));
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
