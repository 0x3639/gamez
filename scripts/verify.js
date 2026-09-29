const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { DEVNET, readDeployment, sleep, requireDevnet } = require("./lib/devnet");

function latestBuildInfo() {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error("no build-info: run npx hardhat compile");
  return JSON.parse(fs.readFileSync(path.join(dir, files[0].f), "utf8"));
}

async function main() {
  await requireDevnet(ethers.provider);
  const d = readDeployment();
  const info = latestBuildInfo();
  const compilers = await (await fetch(`${DEVNET.api}/verify/compilers`)).json();
  const build = compilers.builds.find((b) => info.solcLongVersion
    ? b.longVersion === info.solcLongVersion
    : b.version === info.solcVersion && !b.longVersion.includes("pre"));
  if (!build) throw new Error(`verifier has no solc ${info.solcLongVersion || info.solcVersion}`);
  // Only send the sources the contract needs (SlotMachine + its OpenZeppelin imports).
  const input = { ...info.input, sources: Object.fromEntries(
    Object.entries(info.input.sources).filter(([p]) => !p.startsWith("contracts/test/"))) };
  const body = {
    address: d.address,
    compiler: build.longVersion,
    contract: "contracts/SlotMachine.sol:SlotMachine",
    input,
    constructorArgs: d.constructorArgs,
  };
  const res = await fetch(`${DEVNET.api}/verify`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const job = await res.json();
  if (!res.ok || job.error) throw new Error(job.error || `verify HTTP ${res.status}: ${JSON.stringify(job)}`);
  console.log("verify job", job.id, job.status);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = await (await fetch(`${DEVNET.api}/verify/${job.id}`)).json();
    if (st.status === "verified") { console.log("verified:", `${DEVNET.explorer}/address/${d.address}`); return; }
    if (st.status === "failed") throw new Error(`verification failed: ${JSON.stringify(st)}`);
    process.stdout.write(".");
  }
  throw new Error("verification timed out");
}

main().catch((e) => { console.error(e); process.exit(1); });
