import type { Address } from "viem";
import { EXPLORER } from "./config";
import { formatZnn, formatZnnDown, multiplierX10, SYMBOLS } from "./logic";
import type { Result, State } from "./chain";

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export function short(a: Address): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
export function txLink(hash: string): string { return `${EXPLORER}/tx/${hash}`; }
export function addrLink(a: string): string { return `${EXPLORER}/address/${a}`; }

export function sym(i: number): string {
  const s = SYMBOLS[i];
  return `<img class="symsmall" src="${s.image}" alt="${s.label}" />`;
}

export function layout(slotAddress: string): string {
  return `
  <header class="top">
    <div class="brand"><span class="logo">Z</span> gamez <span class="tag">ZVM devnet</span></div>
    <div class="wallet"><span id="net" class="pill">not connected</span><button id="connect" class="btn">Connect wallet</button></div>
  </header>
  <main class="wrap">
    <section class="cabinet">
      <div class="marquee"><span>ZENON SLOTS</span><span class="sub">play money · devnet</span></div>
      <div id="reels" class="reels" aria-live="polite"></div>
      <div id="result" class="result" role="status"></div>
      <form id="betform" class="controls" autocomplete="off">
        <label class="betlabel">Bet <input id="bet" inputmode="decimal" value="0.5" aria-describedby="limits" /> <span class="unit">wZNN</span></label>
        <div id="limits" class="limits"></div>
        <button id="spin" class="btn spin" type="submit" disabled>SPIN</button>
      </form>
      <div id="status" class="status" role="status"></div>
      <div id="resume" class="resume hidden"></div>
    </section>

    <section class="panel" id="funds">
      <h2>Your funds</h2>
      <dl class="stats">
        <div><dt>ZNN</dt><dd id="znn">–</dd></div>
        <div><dt>wZNN</dt><dd id="wznn">–</dd></div>
        <div><dt>Bankroll</dt><dd id="bankroll">–</dd></div>
      </dl>
      <div class="row">
        <button id="faucet" class="btn ghost" disabled>Get 5 devnet ZNN</button>
      </div>
      <form id="wrapform" class="row">
        <input id="wrapamt" inputmode="decimal" placeholder="amount" aria-label="amount to wrap or unwrap" />
        <button id="wrap" class="btn ghost" type="submit" disabled>Wrap ZNN → wZNN</button>
        <button id="unwrap" class="btn ghost" type="button" disabled>Unwrap</button>
      </form>
      <p id="fundsmsg" class="muted"></p>
    </section>

    <section class="panel">
      <h2>Recent spins</h2>
      <ol id="history" class="history"><li class="muted">Connect to see your spins.</li></ol>
    </section>

    <section class="panel">
      <h2>Paytable</h2>
      <table class="paytable">
        <tr><td>${sym(5)} ${sym(5)} ${sym(5)}</td><td>${multiplierX10(5,5,5)/10}×</td></tr>
        <tr><td>${sym(4)} ${sym(4)} ${sym(4)}</td><td>${multiplierX10(4,4,4)/10}×</td></tr>
        <tr><td>any other three of a kind</td><td>${multiplierX10(0,0,0)/10}×</td></tr>
        <tr><td>any pair</td><td>${multiplierX10(0,0,1)/10}×</td></tr>
      </table>
      <p class="muted">Return to player 92.6%. Each spin is two transactions: place the bet, then settle once the next block exists. The result comes from that block's hash and cannot be changed by when you settle. Unsettled spins are forfeited after 256 blocks (about 40 minutes).</p>
    </section>
  </main>
  <footer class="foot">
    <a href="${addrLink(slotAddress)}" target="_blank" rel="noopener">contract ${short(slotAddress as Address)}</a>
    · <a href="https://devnet.zenon.foo/status/" target="_blank" rel="noopener">devnet status</a>
    · devnet play money, nothing here has value
  </footer>`;
}

export function renderState(s: State, player: Address | null): void {
  $("#znn").textContent = player ? formatZnn(s.znn) : "–";
  $("#wznn").textContent = player ? formatZnn(s.wznn) : "–";
  $("#bankroll").textContent = `${formatZnn(s.bankroll)} wZNN`;
  $("#limits").textContent = s.paused ? "Machine paused" : `min ${formatZnn(s.minBet)} · max ${formatZnnDown(s.maxBet)} wZNN`;
}

export function renderHistory(rows: Result[]): void {
  const ol = $("#history");
  if (!rows.length) { ol.innerHTML = `<li class="muted">No spins yet.</li>`; return; }
  ol.innerHTML = rows.map((r) => {
    const reels = r.reels ? r.reels.map((i) => sym(i)).join(" ") : "expired";
    const out = r.expired ? "forfeited" : r.payout > 0n ? `+${formatZnn(r.payout)}` : "no win";
    return `<li><span class="reelsmall">${reels}</span><span>${formatZnn(r.amount)} wZNN</span><span class="${r.payout > 0n ? "win" : ""}">${out}</span><a href="${txLink(r.txHash)}" target="_blank" rel="noopener">tx</a></li>`;
  }).join("");
}

export function setStatus(msg: string, kind: "" | "error" | "ok" = ""): void {
  const el = $("#status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

const CONTRACT_ERRORS: [string, string][] = [
  ["TooEarly", "Too early to settle, wait for the next block"],
  ["AlreadySettled", "This spin was already settled"],
  ["UnknownSpin", "Unknown spin"],
  ["BetTooSmall", "Bet is below the minimum"],
  ["BetTooLarge", "Bet is above the current maximum"],
  ["EnforcedPause", "The machine is paused"],
  ["InsufficientUnlocked", "Not enough unreserved bankroll"],
  ["ERC20InsufficientAllowance", "Approve wZNN first"],
  ["ERC20InsufficientBalance", "Not enough wZNN, wrap more first"],
];

type ErrLike = { name?: string; code?: number; message?: string; shortMessage?: string; details?: string; cause?: unknown };

/** Every text field on the error and its nested causes, joined for matching. */
function errorTexts(e: unknown): string {
  const parts: string[] = [];
  let cur = e as ErrLike | undefined;
  for (let depth = 0; cur && typeof cur === "object" && depth < 6; depth++) {
    for (const k of ["name", "shortMessage", "message", "details"] as const) {
      if (typeof cur[k] === "string") parts.push(cur[k] as string);
    }
    cur = cur.cause as ErrLike | undefined;
  }
  return parts.join("\n");
}

export function errorText(e: unknown): string {
  const anyE = e as ErrLike;
  const all = errorTexts(e);
  const code = anyE?.code ?? (anyE?.cause as ErrLike | undefined)?.code;
  if (code === 4001 || /user rejected|rejected the request|user denied/i.test(all)) return "Cancelled in the wallet";
  if (/ChainMismatch/i.test(all) || (/chain/i.test(all) && /mismatch|does not match/i.test(all))) return "Switch to ZVM devnet to play";
  if (/insufficient funds/i.test(all)) return "Not enough ZNN to pay for gas";
  for (const [name, text] of CONTRACT_ERRORS) if (all.includes(name)) return text;
  return anyE?.shortMessage ?? anyE?.message ?? String(e);
}
