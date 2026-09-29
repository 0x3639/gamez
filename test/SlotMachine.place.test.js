const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup(TokenName = "MockWETH") {
  const [owner, alice] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory(TokenName)).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(slotAddr, E(100));          // bankroll -> maxBet = min(5, 2.5) = 2.5
  await tok.mint(alice.address, E(10));
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, tok, slot, slotAddr };
}

describe("SlotMachine.placeBet", () => {
  it("takes the bet, reserves 40x, targets the next block and emits", async () => {
    const { alice, tok, slot, slotAddr } = await setup();
    const tx = await slot.connect(alice).placeBet(E(1));
    const rc = await tx.wait();
    await expect(tx).to.emit(slot, "SpinPlaced").withArgs(1n, alice.address, E(1), BigInt(rc.blockNumber) + 1n);
    expect(await tok.balanceOf(slotAddr)).to.equal(E(101));
    expect(await tok.balanceOf(alice.address)).to.equal(E(9));
    expect(await slot.locked()).to.equal(E(40));
    expect(await slot.nextSpinId()).to.equal(2n);
    const s = await slot.spins(1n);
    expect(s.player).to.equal(alice.address);
    expect(s.amount).to.equal(E(1));
    expect(s.targetBlock).to.equal(BigInt(rc.blockNumber) + 1n);
    expect(s.settled).to.equal(false);
    expect(await slot.canSettle(1n)).to.equal(false); // target block not mined yet
  });

  it("rejects below min, above max, and above the cap", async () => {
    const { alice, slot } = await setup();
    await expect(slot.connect(alice).placeBet(MIN - 1n)).to.be.revertedWithCustomError(slot, "BetTooSmall");
    await expect(slot.connect(alice).placeBet(E(2.5) + 1n)).to.be.revertedWithCustomError(slot, "BetTooLarge");
    await expect(slot.connect(alice).placeBet(E(2.5))).to.not.be.reverted;
  });

  it("reservations shrink maxBet until settled", async () => {
    const { alice, slot } = await setup();
    expect(await slot.maxBet()).to.equal(E(2.5));
    await slot.connect(alice).placeBet(E(2));           // balance 102, locked 80 -> unlocked 22 -> 0.55
    expect(await slot.maxBet()).to.equal(E(0.55));
    await expect(slot.connect(alice).placeBet(E(1))).to.be.revertedWithCustomError(slot, "BetTooLarge");
  });

  it("rejects without allowance or balance", async () => {
    const { owner, alice, tok, slot, slotAddr } = await setup();
    await tok.connect(alice).approve(slotAddr, 0n);
    await expect(slot.connect(alice).placeBet(E(1))).to.be.revertedWithCustomError(tok, "ERC20InsufficientAllowance");
    await tok.connect(owner).approve(slotAddr, ethers.MaxUint256);
    await expect(slot.connect(owner).placeBet(E(1))).to.be.revertedWithCustomError(tok, "ERC20InsufficientBalance");
  });

  it("credits only what actually arrived from a fee-on-transfer token", async () => {
    const { alice, slot } = await setup("FeeToken");
    await slot.connect(alice).placeBet(E(1));
    const s = await slot.spins(1n);
    expect(s.amount).to.equal(E(0.99));
    expect(await slot.locked()).to.equal(E(0.99) * 40n);
  });

  it("is blocked while paused", async () => {
    const { owner, alice, slot } = await setup();
    await slot.connect(owner).pause();
    await expect(slot.connect(alice).placeBet(E(1))).to.be.revertedWithCustomError(slot, "EnforcedPause");
    await slot.connect(owner).unpause();
    await expect(slot.connect(alice).placeBet(E(1))).to.not.be.reverted;
  });
});
