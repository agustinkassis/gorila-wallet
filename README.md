# 🦍 Gorilla Wallet

A self-hosted Bitcoin wallet with Nostr login, coin control and an optional **Blake2b (XBT)** extension.

The seed lives only on your server. The browser gets the account xpub (to derive addresses and build
unsigned PSBTs) and asks the backend to sign over [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md)
authenticated requests, restricted to an allowlist of Nostr pubkeys.

## Features

- **Nostr login** (NIP-07 extension), avatar in the navbar, NIP-98 + allowlist on every API call
- **Live balances and transactions** over SSE from Electrum/Fulcrum subscriptions, with server failover
- **Send**: batch recipients, Send max, coin control (auto-suggested UTXOs), fee manager with mempool estimates
- **Review → Sign → Broadcast** modal: unsigned PSBT as animated QR (UR `crypto-psbt`, BBQr, base64, `.psbt`), signed tx QR, broadcast to the chain's mempool
- **Fee bumping**: RBF (redesign the replacement: add coins, change amounts, take the fee from the payment) and CPFP
- **Coin control**: freeze / unfreeze, labels on coins, addresses and txs, BIP-329 export/import
- **Receive**: next unused address with QR, gap-limit discovery (20 receive / 10 change), change on the internal chain
- **Notifications**: toast, sound, animation and system notification on incoming payments and confirmations
- **Local SQLite cache** (Prisma): addresses, UTXOs, txs, raw txs, block times, labels, settings; warm start, Electrum status-hash sync

## Blake2b extension (on by default)

Toggle it in **Settings → Extensions**. When on, the same keys are also tracked on the Bitcoin BLAKE2b fork (XBT):

- Blake sends are signed with **SIGHASH_UNIFIED** (`ALL|UNIFIED = 0x21`, Bitcoin Knots v29.4.1+), which Bitcoin rejects:
  they can't be replayed to move your BTC. Verified against the 166 reference vectors in `scripts/vectors/`.
- Bitcoin sends can carry a **Bitcoin-only OP_RETURN** (≥ 84 bytes). Blake's consensus rejects OP_RETURNs over 83 bytes
  (until 2027-09-01), so the transaction can never confirm there. The send form warns when a BTC spend of pre-fork coins
  could be replayed on Blake.
- Blake transactions refuse OP_RETURN outputs and output scripts over 34 bytes (Blake consensus).

When off, XBT sync stops and the UI is Bitcoin-only. Cached XBT data stays in SQLite for a warm restart.

## Setup

Requires **Node 24** (`.nvmrc`) and pnpm.

```bash
nvm use
pnpm install          # also generates the Prisma client
cp .env.example .env  # then fill in SEED_PHRASE and ALLOWED_PUBKEYS
pnpm dev              # applies migrations, starts on http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `SEED_PHRASE` | BIP39 mnemonic. Read only by `lib/server/keys.ts`, never sent to the browser |
| `DERIVATION_PATH` | Account path, e.g. `m/84'/0'/0'` (P2WPKH) |
| `ALLOWED_PUBKEYS` | Comma-separated npub/hex keys allowed to log in |
| `BTC_ELECTRUM`, `XBT_ELECTRUM` | Comma-separated `tcp://` / `ssl://` Electrum servers, tried in order |
| `MEMPOOL_BTC_URL`, `MEMPOOL_XBT_URL` | Fee estimates, broadcast, explorer links |
| `DATABASE_URL` | SQLite file (default `file:./data/wallet.db`) |

## Scripts

| Command | |
|---|---|
| `pnpm dev` / `pnpm start` | Migrate, then run (dev / production) |
| `pnpm build` | Production build |
| `pnpm check` | Self-checks: SIGHASH_UNIFIED vectors, signing round trips, coin selection, fee math, NIP-98 |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Apply Prisma migrations |

## Security model

- The backend signs only inputs that are provably this wallet's coins (derivation path, fingerprint and script checked
  against the real parent transaction), refuses frozen coins and chain-rule violations, and caps fee rates.
- POST bodies are bound to the NIP-98 signature (`payload` tag), so a captured token can't carry a different body.
- The local database holds no secrets; `.env` and `data/` are git-ignored.

## Layout

```
app/                 pages (dashboard, send, receive, transactions, utxos, settings) and API routes
components/          UI (shadcn/ui), providers, QR
lib/wallet.ts        shared types and address helpers
lib/tx.ts            coin selection, fee policies, PSBT building, per-chain output rules
lib/unified-sighash.ts  SIGHASH_UNIFIED
lib/server/          keys, auth, Electrum client, sync engine, signer, settings, labels (server-only)
prisma/              schema and migrations
scripts/check.ts     pnpm check
```
