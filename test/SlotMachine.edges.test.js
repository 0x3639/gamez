const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const MIN = ethers.parseEther("0.1");
const CAP = ethers.parseEther("5");
const E = (n) => ethers.parseEther(String(n));

async function setup(TokenName = "MockWETH", bankroll = E(100)) {
  const [owner, alice, bob] = await ethers.getSigners();
  const tok = await (await ethers.getContractFactory(TokenName)).deploy();
  const slot = await (await ethers.getContractFactory("SlotMachine")).deploy(
    await tok.getAddress(), owner.address, MIN, CAP);
  const slotAddr = await slot.getAddress();
  await tok.mint(slotAddr, bankroll);
  await tok.mint(alice.address, E(10));
  await tok.connect(alice).approve(slotAddr, ethers.MaxUint256);
  return { owner, alice, bob, tok, slot, slotAddr };
}

function parse(slot, rc, names) {
  return rc.logs.map((l) => { try { return slot.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && names.includes(p.name));
}

async function place(slot, signer, amount) {
  const rc = await (await slot.connect(signer).placeBet(amount)).wait();
  const ev = parse(slot, rc, ["SpinPlaced"]);
  return { id: ev.args.id, targetBlock: Number(ev.args.targetBlock) };
}

// Mine so that the *next* transaction lands exactly `age` blocks after targetBlock.
async function mineUntilSettleAge(targetBlock, age) {
  const head = await ethers.provider.getBlockNumber();
  const toMine = targetBlock + age - 1 - head;
  expect(toMine).to.be.greaterThan(0);
  await mine(toMine);
  expect((await ethers.provider.getBlockNumber()) + 1 - targetBlock).to.equal(age);
}

describe("SlotMachine edge cases", () => {
  it("constructor accepts maxBetCap == 2^96-1 and minBet == maxBetCap, rejects 2^96 and a zero owner", async () => {
    const [owner] = await ethers.getSigners();
    const tok = await (await ethers.getContractFactory("MockWETH")).deploy();
    const tokAddr = await tok.getAddress();
    const F = await ethers.getContractFactory("SlotMachine");

    const max96 = 2n ** 96n - 1n;
    const a = await F.deploy(tokAddr, owner.address, MIN, max96);
    expect(await a.maxBetCap()).to.equal(max96);

    const b = await F.deploy(tokAddr, owner.address, E(1), E(1));
    expect(await b.minBet()).to.equal(E(1));
    expect(await b.maxBetCap()).to.equal(E(1));

    await expect(F.deploy(tokAddr, owner.address, MIN, 2n ** 96n)).to.be.revertedWithCustomError(F, "BadLimits");
    await expect(F.deploy(tokAddr, ethers.ZeroAddress, MIN, CAP))
      .to.be.revertedWithCustomError(F, "OwnableInvalidOwner");
  });

  it("placeBet rejects when the credited amount lands below minBet", async () => {
    const { alice, slot } = await setup("FeeToken");
    // MIN passes the pre-transfer check, but the 1% fee credits only 0.099.
    await expect(slot.connect(alice).placeBet(MIN)).to.be.revertedWithCustomError(slot, "BetTooSmall");
  });

  it("pause and unpause are owner-only", async () => {
    const { alice, slot } = await setup();
    await expect(slot.connect(alice).pause()).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
    await expect(slot.connect(alice).unpause()).to.be.revertedWithCustomError(slot, "OwnableUnauthorizedAccount");
  });

  it("a spin whose target block is exactly 256 blocks old still settles; 257 expires", async () => {
    const { alice, slot } = await setup();

    const a = await place(slot, alice, E(1));
    await mineUntilSettleAge(a.targetBlock, 256);
    const rcA = await (await slot.settle(a.id)).wait();
    expect(rcA.blockNumber - a.targetBlock).to.equal(256);
    expect(parse(slot, rcA, ["SpinSettled", "SpinExpired"]).name).to.equal("SpinSettled");

    const b = await place(slot, alice, E(1));
    await mineUntilSettleAge(b.targetBlock, 257);
    const rcB = await (await slot.settle(b.id)).wait();
    expect(rcB.blockNumber - b.targetBlock).to.equal(257);
    expect(parse(slot, rcB, ["SpinSettled", "SpinExpired"]).name).to.equal("SpinExpired");
  });

  it("maxBet can be below minBet when the bankroll is thin, and placeBet then rejects", async () => {
    const { alice, slot } = await setup("MockWETH", E(2));
    expect(await slot.maxBet()).to.equal(E(0.05));
    await expect(slot.connect(alice).placeBet(E(0.1))).to.be.revertedWithCustomError(slot, "BetTooLarge");
    await expect(slot.connect(alice).placeBet(E(0.05))).to.be.revertedWithCustomError(slot, "BetTooSmall");
  });
});
