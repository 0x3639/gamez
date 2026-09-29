import { approveMax, placeBet, previewSpin, readState, settle, waitForBlockAfter, type Preview, type SettleOutcome } from "./chain";
import { checkFunds } from "./logic";
import { currentAccount, ensureChain } from "./wallet";

export type SpinHooks = {
  status(msg: string): void;
  placed(id: bigint, txHash: `0x${string}`): void;
  /** Called on each poll while the target block has not arrived yet. */
  waiting(targetBlock: bigint, currentBlock: bigint): void;
  /** Called the moment the target block exists, with the result computed off-chain. */
  preview(p: Preview): Promise<void> | void;
  settled(outcome: SettleOutcome): Promise<void> | void;
};

function collectPrompt(p: Preview): string {
  if (p.kind === "expired") return "This spin expired. Confirm in your wallet to clear it…";
  return p.payout > 0n ? "Confirm in your wallet to collect your winnings…" : "Confirm in your wallet to finish the spin…";
}

/** approve (once) → placeBet → wait for target block → settle. Throws plain-English errors. */
export async function runSpin(bet: bigint, hooks: SpinHooks): Promise<void> {
  await ensureChain();
  const player = await currentAccount();
  if (!player) throw new Error("Connect a wallet first");
  const st = await readState(player);
  if (st.paused) throw new Error("The machine is paused");
  const fundsMsg = checkFunds(bet, st.wznn);
  if (fundsMsg) throw new Error(fundsMsg);
  if (st.allowance < bet) {
    hooks.status("Approve wZNN once in your wallet…");
    await approveMax();
  }
  hooks.status("Confirm the bet in your wallet…");
  const { id, targetBlock, txHash } = await placeBet(bet);
  hooks.placed(id, txHash);
  hooks.status("Bet placed. Waiting for the next block…");
  await waitForBlockAfter(targetBlock, (current) => hooks.waiting(targetBlock, current));
  const p = await previewSpin(id, bet, targetBlock);
  await hooks.preview(p);
  hooks.status(collectPrompt(p));
  const outcome = await settle(id);
  await hooks.settled(outcome);
}

/** Settle a spin left over from an earlier session. */
export async function resumeSpin(id: bigint, amount: bigint, targetBlock: bigint, hooks: SpinHooks): Promise<void> {
  await ensureChain();
  hooks.status("Waiting for the target block…");
  await waitForBlockAfter(targetBlock, (current) => hooks.waiting(targetBlock, current));
  const p = await previewSpin(id, amount, targetBlock);
  await hooks.preview(p);
  hooks.status(collectPrompt(p));
  await hooks.settled(await settle(id));
}
