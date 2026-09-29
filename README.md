# gamez — slot machine on the ZVM devnet

Play at https://gamez.0x3639.com. Devnet only; play money.

- Contract: `contracts/SlotMachine.sol` (Hardhat, Solidity 0.8.28, OpenZeppelin 5)
- Front end: `web/` (Vite + TypeScript + viem), deployed by GitHub Pages
- Network: ZVM devnet, chain id 7340469, RPC https://devnet.zenon.foo/zvm/rpc

## Develop

    npm install && npm test
    cd web && npm install && npm run dev

## Devnet deployment

- Contract: [`0xC5Cc264FBA954Ce760030928589Ab4644BD57774`](https://devnet.zenon.foo/explorer/address/0xC5Cc264FBA954Ce760030928589Ab4644BD57774) (verified, exact match)
- Wrapped ZNN (wZNN) token: `0x91F5DDA8243e34697C99bE282e05bf48e35A0115`
- Deploy block: 61340
- Bankroll funded: 50 wZNN (max bet 1.25 wZNN)
- Owner: the deployer key on the maintainer's machine; transfer with `transferOwnership(newOwner)` then `acceptOwnership()` from the new owner.

### Deploying your own

    node scripts/new-key.js                                   # writes .env, prints the address only
    FAUCET_ONLY=1 FAUCET_REQUESTS=12 npm run fund:devnet      # collect devnet ZNN from the faucet
    npm run deploy:devnet
    npm run verify:devnet
    FAUCET_REQUESTS=0 BANKROLL=50 npm run fund:devnet         # wrap and fund the bankroll
    npm run smoke:devnet                                      # one real bet and settle
    npm run settle-open:devnet                                # keeper: settle every settleable spin

Run `npm run settle-open:devnet` periodically (cron-able) so nobody can hold bankroll
capacity by leaving a bet unsettled. If you create `.env` by hand instead of using
`new-key.js`, run `chmod 600 .env`, and write the private key with the `0x` prefix.

### Hosting

The front end is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push
to `main`. The custom domain `gamez.0x3639.com` comes from `web/public/CNAME`; DNS is
`CNAME gamez → 0x3639.github.io`.
