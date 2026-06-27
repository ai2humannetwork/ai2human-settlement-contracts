# AI2Human Settlement Contracts

Base settlement contracts for verified rewards, prize pools, task payouts, and escrow flows.

## Why This Exists

AI2Human settlement should be conditional on verification.

The settlement layer supports:

- USDC prize pools
- holder-gated campaigns
- backend-verified claims
- payout reconciliation
- refund paths after deadline

## Architecture

```text
campaign created
  -> pool deployed
  -> pool funded
  -> users complete tasks
  -> proof verified
  -> winners claim or backend pays
  -> remaining funds refunded or reconciled
```

## Contracts

- `contracts/src/PrizePool.sol`
- `contracts/src/PrizePoolFactory.sol`

## Product Evidence

See:

- `docs/base-live-settlement-proof.md`

## Status

Contract seed extracted from the live AI2Human product. Keep audits, deployments, and mainnet addresses explicit before production use.

## Links

- Website: https://ai2human.work
- X: https://x.com/ai2humannetwork

