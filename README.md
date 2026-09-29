# gamez — slot machine on the ZVM devnet

Play at https://gamez.0x3639.com. Devnet only; play money.

- Contract: `contracts/SlotMachine.sol` (Hardhat, Solidity 0.8.28, OpenZeppelin 5)
- Front end: `web/` (Vite + TypeScript + viem), deployed by GitHub Pages
- Network: ZVM devnet, chain id 7340469, RPC https://devnet.zenon.foo/zvm/rpc

## Develop

    npm install && npm test
    cd web && npm install && npm run dev

## Deploy (devnet)

    cp .env.example .env   # add DEPLOYER_PRIVATE_KEY
    npm run deploy:devnet && npm run verify:devnet && npm run fund:devnet

## Devnet deployment

- Contract: [`0xC5Cc264FBA954Ce760030928589Ab4644BD57774`](https://devnet.zenon.foo/explorer/address/0xC5Cc264FBA954Ce760030928589Ab4644BD57774) (verified, exact match)
- Wrapped ZNN (wZNN) token: `0x91F5DDA8243e34697C99bE282e05bf48e35A0115`
- Deploy block: 61340
- Bankroll funded: 50 wZNN (max bet 1.25 wZNN)
- Owner: the deployer key on the maintainer's machine; transfer with `transferOwnership(newOwner)` then `acceptOwnership()` from the new owner.
