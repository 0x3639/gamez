import "./style.css";
import type { Address } from "viem";
import { parseUnits } from "viem";
import { ADDRESSES } from "./config";
import { findOpenSpins, readState as readChainState, recentResults, unwrap, wrap, type Preview, type SettleOutcome, type State } from "./chain";
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

let unreachable = false;
let lastRows: Awaited<ReturnType<typeof recentResults>> = [];
let lastRowsFor: Address | null = null;
let refreshSeq = 0;

/** Re-read chain state and repaint. The last-started refresh wins; a failed read keeps the last good UI. */
async function refresh(): Promise<void> {
  const seq = ++refreshSeq;
  try {
    const acct = await currentAccount();
    const chainId = await currentChainId();
    if (seq !== refreshSeq) return;
    const onDevnet = isDevnet(chainId);
    const active = acct && onDevnet ? acct : null;
    const st = await readChainState(active);
    if (seq !== refreshSeq) return;
    let rows = lastRowsFor === active ? lastRows : [];
    let open: Awaited<ReturnType<typeof findOpenSpins>> = [];
    if (active) {
      try {
        rows = await recentResults(active);
      } catch {
        // keep the last successfully rendered history rather than clearing it
      }
      if (seq !== refreshSeq) return;
      open = await findOpenSpins(active);
      if (seq !== refreshSeq) return;
    }

    player = acct;
    state = st;
    $("#net").textContent = player ? (onDevnet ? `ZVM devnet · ${short(player)}` : `wrong network · ${short(player)}`) : "not connected";
    $("#net").className = `pill ${player && !onDevnet ? "warn" : ""}`;
    $("#connect").textContent = player ? (onDevnet ? "Connected" : "Switch to ZVM devnet") : "Connect wallet";
    renderState(state, active);
    const enabled = !!active && !busy;
    for (const id of ["#spin", "#faucet", "#wrap", "#unwrap"]) ($(id) as HTMLButtonElement).disabled = !enabled;
    lastRows = rows;
    lastRowsFor = active;
    renderHistory(rows);
    const box = $("#resume");
    if (open.length && !busy) {
      const o = open[0];
      box.classList.remove("hidden");
      const expired = o.targetBlock + 256n < st.block;
      box.innerHTML = expired
        ? `This spin expired (bet forfeited). Settle it to clear it. <button id="settleopen" class="btn">Settle it</button>`
        : `You have an unsettled spin of ${formatZnn(o.amount)} wZNN. <button id="settleopen" class="btn">Settle it</button>`;
      $("#settleopen").addEventListener("click", () => guard(async () => {
        $("#result").textContent = "";
        previewed = null;
        waitStarted = 0;
        betLink = "";
        reels.start();
        await resumeSpin(o.id, o.amount, o.targetBlock, hooks);
      }));
    } else {
      box.classList.add("hidden");
      box.innerHTML = "";
    }
    if (unreachable && !busy) { unreachable = false; setStatus(""); }
  } catch {
    if (seq !== refreshSeq) return;
    unreachable = true;
    if (!busy) setStatus("Can't reach the machine contract right now.", "error");
  }
}

let waitStarted = 0;
let previewed: Preview | null = null;
let betLink = "";

const hooks = {
  status: (m: string) => setStatus(m),
  placed: (_id: bigint, txHash: `0x${string}`) => {
    previewed = null;
    waitStarted = 0;
    betLink = `<a href="${txLink(txHash)}" target="_blank" rel="noopener">bet ↗</a>`;
    reels.start();
    $("#result").innerHTML = betLink;
  },
  waiting: (target: bigint, current: bigint) => {
    if (!waitStarted) waitStarted = Date.now();
    const secs = Math.round((Date.now() - waitStarted) / 1000);
    $("#result").innerHTML = `Waiting for block ${target.toLocaleString()} <span class="muted">(chain is at ${current.toLocaleString()}, ${secs}s)</span>${betLink ? " · " + betLink : ""}`;
  },
  // The target block exists: show the result now, before the settle transaction is mined.
  preview: async (p: Preview) => {
    previewed = p;
    if (p.kind === "expired") {
      reels.showIdle();
      $("#result").innerHTML = "This spin expired before it was settled, so the bet is forfeited.";
      return;
    }
    await reels.stopOn(p.reels);
    if (p.payout > 0n) {
      reels.markWin();
      $("#result").innerHTML = `<strong>You win ${formatZnn(p.payout)} wZNN</strong> <span class="muted">collecting…</span>`;
    } else {
      $("#result").innerHTML = `No win this time. <span class="muted">finishing…</span>`;
    }
  },
  settled: async (o: SettleOutcome) => {
    if (o.kind === "expired") {
      reels.showIdle();
      $("#result").innerHTML = `Spin expired, bet forfeited. <a href="${txLink(o.txHash)}" target="_blank" rel="noopener">tx ↗</a>`;
      setStatus("");
      return;
    }
    const same = previewed?.kind === "result" && previewed.reels.every((r: number, i: number) => r === o.reels[i]);
    if (!same) { reels.start(); await reels.stopOn(o.reels); } // preview missing or (reorg) different: re-run the stop
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
    if (previewed) $("#result").textContent = "Not settled yet. Use the Settle button below to finish this spin.";
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
