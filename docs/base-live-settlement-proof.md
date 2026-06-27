# Base Live Settlement Proof

## Summary

- Product: `ai2human`
- Rail: `Base`
- Asset: `USDC`
- Settlement amount: `0.01 USDC`
- Settlement wallet: `0x3f665386b41Fa15c5ccCeE983050a236E6a10108`
- Receiver wallet: `0x81009cc711e5e0285dd8f703aab1af69fa4a4390`

## Transactions

### Treasury Top-Up

- Tx hash: `0x3fe5b99b2af4934c3b30d3087a703157e4f7cfcb8fc5dc58cecb48e249788f5e`
- Explorer: <https://basescan.org/tx/0x3fe5b99b2af4934c3b30d3087a703157e4f7cfcb8fc5dc58cecb48e249788f5e>
- Purpose: fund the product settlement wallet with Base USDC from the connected Bankr treasury wallet

### Live Settlement

- Tx hash: `0xee543bc107b411edd0202131b82172eb6efaf29c10457e33d2900ae890a72cf0`
- Explorer: <https://basescan.org/tx/0xee543bc107b411edd0202131b82172eb6efaf29c10457e33d2900ae890a72cf0>
- Purpose: real Base USDC payout from the product settlement wallet to the operator payout wallet

## Notes

- This receipt is now the primary onchain proof for the Base-first version of the product.
- Historical BNB Chain and X Layer receipts remain archived for earlier iterations.
