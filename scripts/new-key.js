// Generates a deployer key into .env if none exists. Prints the address only.
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const envPath = path.join(__dirname, "..", ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^DEPLOYER_PRIVATE_KEY=0x[0-9a-fA-F]{64}/m.test(existing)) {
  const key = existing.match(/^DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1];
  console.log("existing deployer:", new Wallet(key).address);
  process.exit(0);
}
const w = Wallet.createRandom();
fs.writeFileSync(envPath, `${existing.trim()}\nDEPLOYER_PRIVATE_KEY=${w.privateKey}\n`.trimStart(), { mode: 0o600 });
console.log("new deployer:", w.address);
