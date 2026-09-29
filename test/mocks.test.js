const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("test tokens", () => {
  it("MockWETH wraps native value 1:1", async () => {
    const [a] = await ethers.getSigners();
    const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
    await weth.deposit({ value: ethers.parseEther("2") });
    expect(await weth.balanceOf(a.address)).to.equal(ethers.parseEther("2"));
    await weth.withdraw(ethers.parseEther("0.5"));
    expect(await weth.balanceOf(a.address)).to.equal(ethers.parseEther("1.5"));
  });

  it("FeeToken burns 1% on transfer", async () => {
    const [a, b] = await ethers.getSigners();
    const fee = await (await ethers.getContractFactory("FeeToken")).deploy();
    await fee.mint(a.address, 1000n);
    await fee.transfer(b.address, 100n);
    expect(await fee.balanceOf(b.address)).to.equal(99n);
  });

  it("ReentrantToken calls its target during transfer and records the result", async () => {
    const [a, b] = await ethers.getSigners();
    const tok = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    await tok.mint(a.address, 10n);
    // arm with a call that must fail: transferring from the zero balance of tok itself
    const data = tok.interface.encodeFunctionData("transfer", [a.address, 1n]);
    await tok.arm(await tok.getAddress(), data);
    await tok.transfer(b.address, 1n);
    expect(await tok.reentryAttempts()).to.equal(1n);
    expect(await tok.lastReentryOk()).to.equal(false);
  });
});
