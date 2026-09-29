import { approveMax, placeBet, readState, settle, waitForBlockAfter, type SettleOutcome } from "./chain";
import { checkFunds } from "./logic";
import { currentAccount, ensureChain } from "./wallet";

export type SpinHooks = {
  status(msg: string): void;
  placed(id: bigint, txHash: `0x${string}`): void;
  settled(outcome: SettleOutcome): Promise<void> | void;
};

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
  await waitForBlockAfter(targetBlock);
  hooks.status("Confirm settle in your wallet…");
  const outcome = await settle(id);
  await hooks.settled(outcome);
}

/** Settle a spin left over from an earlier session. */
export async function resumeSpin(id: bigint, targetBlock: bigint, hooks: SpinHooks): Promise<void> {
  await ensureChain();
  hooks.status("Waiting for the target block…");
  await waitForBlockAfter(targetBlock);
  hooks.status("Confirm settle in your wallet…");
  await hooks.settled(await settle(id));
}
