import "./style.css";
import type { Address } from "viem";
import { parseUnits } from "viem";
import { ADDRESSES } from "./config";
import { findOpenSpins, readState as readChainState, recentResults, unwrap, wrap, type SettleOutcome, type State } from "./chain";
import { requestFaucet } from "./faucet";
import { formatZnn, parseBet } from "./logic";
import { Reels } from "./reels";
import { resumeSpin, runSpin } from "./spin";
import { $, errorText, layout, renderHistory, renderState, setStatus, short, txLink } from "./ui";
import { connect, currentAccount, currentChainId, ensureChain, getInjected, onWalletChange } from "./wallet";
import { isDevnet } from "./logic";

const app = $("#app");
app.innerHTML = layout(ADDRESSES.slot);
const reels = new Reels($("#reels"));

let player: Address | null = null;
let busy = false;
let state: State = { znn: 0n, wznn: 0n, allowance: 0n, minBet: 0n, maxBet: 0n, bankroll: 0n, paused: false, block: 0n };

/** Read contract state; if the machine is unreachable, keep the last known state and say so instead of breaking the page. */
async function readState(who: Address | null): Promise<State> {
  try {
    return await readChainState(who);
  } catch {
    setStatus("Can't reach the machine contract right now.", "error");
    return state;
  }
}

state = await readState(null);
renderState(state, null);

async function refresh(): Promise<void> {
  player = await currentAccount();
  const chainId = await currentChainId();
  const onDevnet = isDevnet(chainId);
  $("#net").textContent = player ? (onDevnet ? `ZVM devnet · ${short(player)}` : `wrong network · ${short(player)}`) : "not connected";
  $("#net").className = `pill ${player && !onDevnet ? "warn" : ""}`;
  $("#connect").textContent = player ? (onDevnet ? "Connected" : "Switch to ZVM devnet") : "Connect wallet";
  state = await readState(player && onDevnet ? player : null);
  renderState(state, player && onDevnet ? player : null);
  const enabled = !!player && onDevnet && !busy;
  for (const id of ["#spin", "#faucet", "#wrap", "#unwrap"]) ($(id) as HTMLButtonElement).disabled = !enabled;
  if (player && onDevnet) {
    renderHistory(await recentResults(player));
    const open = await findOpenSpins(player);
    const box = $("#resume");
    if (open.length && !busy) {
      const o = open[0];
      box.classList.remove("hidden");
      box.innerHTML = `You have an unsettled spin of ${formatZnn(o.amount)} wZNN. <button id="settleopen" class="btn">Settle it</button>`;
      $("#settleopen").addEventListener("click", () => guard(() => resumeSpin(o.id, o.targetBlock, hooks)));
    } else {
      box.classList.add("hidden");
      box.innerHTML = "";
    }
  } else {
    renderHistory([]);
  }
}

const hooks = {
  status: (m: string) => setStatus(m),
  placed: (_id: bigint, txHash: `0x${string}`) => {
    reels.start();
    $("#result").innerHTML = `<a href="${txLink(txHash)}" target="_blank" rel="noopener">bet placed ↗</a>`;
  },
  settled: async (o: SettleOutcome) => {
    if (o.kind === "expired") {
      reels.showIdle();
      $("#result").innerHTML = `Spin expired, bet forfeited. <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("");
      return;
    }
    await reels.stopOn(o.reels);
    if (o.payout > 0n) {
      reels.markWin();
      $("#result").innerHTML = `<strong>You win ${formatZnn(o.payout)} wZNN</strong> <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("Paid out", "ok");
    } else {
      $("#result").innerHTML = `No win this time. <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("");
    }
  },
};

async function guard(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  ($("#spin") as HTMLButtonElement).disabled = true;
  try {
    await fn();
  } catch (e) {
    reels.showIdle();
    setStatus(errorText(e), "error");
  } finally {
    busy = false;
    await refresh();
  }
}

$("#connect").addEventListener("click", () => guard(async () => {
  if (!getInjected()) { setStatus("No wallet found. Install MetaMask or Rabby.", "error"); return; }
  await connect();
  await ensureChain();
  setStatus("");
}));

$("#betform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  guard(async () => {
    const parsed = parseBet(($("#bet") as HTMLInputElement).value, state.minBet, state.maxBet);
    if (!parsed.ok) throw new Error(parsed.message);
    $("#result").textContent = "";
    await runSpin(parsed.value, hooks);
  });
});

$("#faucet").addEventListener("click", () => guard(async () => {
  if (!player) throw new Error("Connect a wallet first");
  $("#fundsmsg").textContent = "Asking the faucet…";
  $("#fundsmsg").textContent = await requestFaucet(player);
  await new Promise((r) => setTimeout(r, 12_000)); // faucet tx lands in the next block
}));

$("#wrapform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  guard(async () => {
    const v = ($("#wrapamt") as HTMLInputElement).value.trim();
    if (!/^\d+(\.\d{1,18})?$/.test(v) || Number(v) <= 0) throw new Error("Enter an amount to wrap");
    const amt = parseUnits(v, 18);
    if (amt > state.znn) throw new Error(`You have ${formatZnn(state.znn)} ZNN`);
    await ensureChain();
    $("#fundsmsg").textContent = "Confirm wrap in your wallet…";
    await wrap(amt);
    $("#fundsmsg").textContent = `Wrapped ${v} ZNN`;
  });
});

$("#unwrap").addEventListener("click", () => guard(async () => {
  const v = ($("#wrapamt") as HTMLInputElement).value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(v) || Number(v) <= 0) throw new Error("Enter an amount to unwrap");
  const amt = parseUnits(v, 18);
  if (amt > state.wznn) throw new Error(`You have ${formatZnn(state.wznn)} wZNN`);
  await ensureChain();
  $("#fundsmsg").textContent = "Confirm unwrap in your wallet…";
  await unwrap(amt);
  $("#fundsmsg").textContent = `Unwrapped ${v} wZNN`;
}));

onWalletChange(() => { refresh(); });
await refresh();
setInterval(() => { if (!busy) refresh(); }, 30_000);
