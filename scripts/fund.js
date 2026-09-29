// Usage: npx hardhat run scripts/fund.js --network zvmDevnet
//   env FAUCET_REQUESTS=12  (5 ZNN each)   env BANKROLL=50  (wZNN to fund)   env FAUCET_ONLY=1
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, faucet, sleep, requireDevnet, WETH_ABI } = require("./lib/devnet");

async function main() {
  await requireDevnet(ethers.provider);
  const [deployer] = await ethers.getSigners();
  const requests = Number(process.env.FAUCET_REQUESTS ?? 12);
  if (!Number.isInteger(requests) || requests < 0) throw new Error(`invalid FAUCET_REQUESTS: ${process.env.FAUCET_REQUESTS}`);
  const bankroll = ethers.parseEther(process.env.BANKROLL ?? "50");
  // Fail before spending any faucet drips if the deployment record is missing.
  const d = process.env.FAUCET_ONLY ? null : readDeployment();

  for (let i = 0; i < requests; i++) {
    try {
      const r = await faucet(deployer.address);
      console.log(`faucet ${i + 1}/${requests}: ok (served ${r.served ?? "?"})`);
    } catch (e) {
      console.log(`faucet ${i + 1}/${requests}: ${e.message}`);
    }
    if (i < requests - 1) await sleep(11000);
  }
  await sleep(12000); // let the last drip land
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`balance ${ethers.formatEther(balance)} ZNN`);
  if (process.env.FAUCET_ONLY) return;

  if (balance < bankroll + ethers.parseEther("0.2")) {
    throw new Error(`native balance ${ethers.formatEther(balance)} ZNN does not cover bankroll ${ethers.formatEther(bankroll)} + 0.2 ZNN gas`);
  }
  const weth = new ethers.Contract(DEVNET.wrappedZnn, WETH_ABI, deployer);
  const slot = await ethers.getContractAt("SlotMachine", d.address, deployer);

  console.log(`wrapping ${ethers.formatEther(bankroll)} ZNN`);
  await (await weth.deposit({ value: bankroll })).wait(1);
  if ((await weth.allowance(deployer.address, d.address)) < bankroll) {
    await (await weth.approve(d.address, ethers.MaxUint256)).wait(1);
  }
  await (await slot.fund(bankroll)).wait(1);
  console.log(`bankroll ${ethers.formatEther(await slot.bankroll())} wZNN, maxBet ${ethers.formatEther(await slot.maxBet())} wZNN`);
}

main().catch((e) => { console.error(e); process.exit(1); });
