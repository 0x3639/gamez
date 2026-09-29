const fs = require("fs");
const path = require("path");

const DEVNET = {
  chainId: 7340469,
  rpc: "https://devnet.zenon.foo/zvm/rpc",
  explorer: "https://devnet.zenon.foo/explorer",
  api: "https://devnet.zenon.foo/zvm/api",
  wrappedZnn: "0x91F5DDA8243e34697C99bE282e05bf48e35A0115",
  minBet: 10n ** 17n,          // 0.1
  maxBetCap: 5n * 10n ** 17n,  // 0.5
};

const DEPLOYMENT_FILE = path.join(__dirname, "..", "..", "web", "src", "deployment.json");

function readDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error("web/src/deployment.json missing: run deploy first");
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function writeDeployment(d) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");
}

async function faucet(address) {
  const res = await fetch(`${DEVNET.api}/faucet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `faucet HTTP ${res.status}`);
  return body;
}

async function requireDevnet(provider) {
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== DEVNET.chainId) {
    throw new Error(`wrong network: chain ${chainId}, expected ${DEVNET.chainId} (use --network zvmDevnet)`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

module.exports = { DEVNET, DEPLOYMENT_FILE, readDeployment, writeDeployment, faucet, sleep, requireDevnet, WETH_ABI };
