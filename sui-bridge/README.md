# Sui escrow bridge

Real, on-chain custodial escrow for the docking marketplace, on **Sui testnet**. The
Python control plane never holds a key or talks to Sui directly — it calls this bridge,
which signs with the single custodial **platform key** and moves real SUI against the
`escrow::escrow` Move module.

Flow: researcher confirms a job → platform **locks** SUI in an on-chain `Escrow` object →
job is verified → platform **releases** that SUI to the provider's address (or **refunds**
itself if the job fails/is abandoned). Every move is a real transaction, auditable on
Suiscan; the digests are shown on the job page.

## Deployed (testnet)

- **Move package id:** `0x44e46fbdcaae2716033573127ce545aa6b91005aa878e750b57797671a23b5ee`
- **Platform (custodial) address:** `0xbfc2f7d32e0b2df8a086fcbe30d394cd4d60b638ae3b53fa7329747a741de072`
- Fund the platform address from https://faucet.sui.io/?address=0xbfc2f7d32e0b2df8a086fcbe30d394cd4d60b638ae3b53fa7329747a741de072

The platform **private key** is not in git. It lives in `sui-bridge/.env.local` (gitignored)
for local dev, and must be set as `SUI_PLATFORM_KEY` in the deployed bridge's environment.

## Two ways the control plane reaches the bridge

The on-chain layer is **opt-in**: with neither env var set, `models.escrow_*` stays the
pure-KV mock and nothing changes.

1. **Local dev — subprocess.** Set on the *control plane*:
   ```
   SUI_BRIDGE_CMD="node /abs/path/to/sui-bridge/cli.mjs"
   SUI_PLATFORM_KEY=suiprivkey1...        # read by cli.mjs
   ESCROW_PACKAGE_ID=0x44e4...b5ee        # read by cli.mjs
   ```

2. **Production — HTTP service.** Deploy `server.mjs` as its own small service (Render /
   Railway / Fly / a separate Vercel project — keeps the existing Vercel control-plane
   project untouched). Set on the *bridge*: `SUI_PLATFORM_KEY`, `ESCROW_PACKAGE_ID`,
   `SUI_BRIDGE_SECRET`. Set on the *control plane*: `SUI_BRIDGE_URL=https://...` and the
   same `SUI_BRIDGE_SECRET`.

   ```
   SUI_PLATFORM_KEY=suiprivkey1... ESCROW_PACKAGE_ID=0x44e4...b5ee \
     SUI_BRIDGE_SECRET=<shared> node server.mjs   # listens on :8787
   ```

## Pricing → SUI

`MIST_PER_PRICE_UNIT` (control plane, default `1000000`) maps one abstract price unit
("$") to MIST. Default is 1 unit = 0.001 SUI, deliberately tiny so testnet funds last.

## Rebuild / republish the Move module

```
cd move/escrow && sui client publish --skip-dependency-verification
```
Then update `ESCROW_PACKAGE_ID` everywhere it's set.

## CLI (handy for manual checks)

```
node cli.mjs address
node cli.mjs lock    <jobId> <amountMist>
node cli.mjs release <escrowObjectId> <providerAddress>
node cli.mjs refund  <escrowObjectId>
```
