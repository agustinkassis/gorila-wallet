# 🦍 Gorilla Wallet

A self-hosted, multi-wallet Bitcoin wallet with Nostr login, coin control and an optional **Blake2b (XBT)** extension.

Keys live only on your server. The browser gets each wallet's xpub (to derive addresses and build unsigned PSBTs)
and asks the backend to sign over [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md)
authenticated requests from allowed Nostr pubkeys. It runs with an **empty `.env`**.

## Wallets

Switch wallets from the top of the sidebar; add more with **Add wallet** (Sparrow-style):

- **Create**: new 12/24 recovery words generated in the browser, a backup check, optional BIP39 passphrase.
- **Import words**: restore from existing BIP39 words (live word and checksum validation).
- **Watch-only**: an xpub or zpub (optional path and master fingerprint). Shown with a *Watch-only* badge;
  every send action is disabled.
- **`.env` wallet**: `SEED_PHRASE` (optional) appears as the default wallet; its seed is never stored.

Software wallets keep their recovery words in SQLite **encrypted with the wallet's password**
(scrypt N=2¹⁶ + AES-256-GCM). The password is asked for at signing time and the seed is decrypted in memory
for that signature only. Every wallet syncs in the background over one shared Electrum connection per chain.

## Features

- **Nostr login** (NIP-07 extension), avatar in the navbar, NIP-98 + allowlist on every API call
- **Live balances and transactions** over SSE from Electrum/Fulcrum subscriptions, with server failover
- **Send**: batch recipients, Send max, coin control (auto-suggested UTXOs), fee manager with mempool estimates
- **Review → Sign → Broadcast** modal: unsigned PSBT as animated QR (UR `crypto-psbt`, BBQr, base64, `.psbt`); sign here,
  or bring back a tx **signed on another device** (scan UR/BBQr with the camera, paste, or load `.psbt`/`.txn`), which is
  finalized and verified against the reviewed transaction (same txid, valid signatures, `0x21` on Blake); then broadcast
- **Fee bumping**: RBF (redesign the replacement: add coins, change amounts, take the fee from the payment) and CPFP
- **Replay** (Blake2b extension): analyze rebroadcasting any of your transactions on the other chain, with an
  inputs → tx → outputs graph and the reason it works or not, then broadcast it
- **Coin control**: freeze / unfreeze, labels on coins, addresses and txs, BIP-329 export/import
- **Receive**: next unused address with QR, gap-limit discovery (20 receive / 10 change), change on the internal chain
- **Notifications**: toast, sound, animation and system notification on incoming payments and confirmations
- **Light / dark / system theme**
- **Local SQLite cache** (Prisma): addresses, UTXOs, txs, raw txs, block times, labels, settings; warm start, Electrum status-hash sync

## Blake2b extension (on by default)

Toggle it in **Settings → Extensions**. When on, the same keys are also tracked on the Bitcoin BLAKE2b fork (XBT):

- Blake sends are signed with **SIGHASH_UNIFIED** (`ALL|UNIFIED = 0x21`, Bitcoin Knots v29.4.1+), which Bitcoin rejects:
  they can't be replayed to move your BTC. Verified against the 166 reference vectors in `scripts/vectors/`.
- Bitcoin sends can carry a **Bitcoin-only OP_RETURN** (≥ 84 bytes). Blake's consensus rejects OP_RETURNs over 83 bytes
  (until 2027-09-01), so the transaction can never confirm there. The send form warns when a BTC spend of pre-fork coins
  could be replayed on Blake.
- Blake transactions refuse OP_RETURN outputs and output scripts over 34 bytes (Blake consensus).
- **Replay analysis** checks, per input and output: the coin is this wallet's and unspent on the target chain, the
  signatures aren't SIGHASH_UNIFIED when going to Bitcoin, outputs fit the target's consensus rules, the locktime is
  final there, the tx isn't already there, and the fee against the target's estimates. The server re-runs the analysis
  and broadcasts the source chain's own bytes; replaying someone else's transaction is never offered.

When off, XBT sync stops and the UI is Bitcoin-only. Cached XBT data stays in SQLite for a warm restart.

## Setup

Requires **Node 24** (`.nvmrc`) and pnpm.

```bash
nvm use
pnpm install          # also generates the Prisma client
pnpm dev              # applies migrations, starts on http://localhost:3000
```

Open it, connect your Nostr extension (the first login claims the app), then create or import a wallet.
Copy `.env.example` to `.env` only to change a default.

| Variable | Purpose |
|---|---|
| `SEED_PHRASE` | Optional default wallet (BIP39). Never sent to the browser or stored |
| `DERIVATION_PATH` | Its account path, default `m/84'/0'/0'` (P2WPKH) |
| `ALLOWED_PUBKEYS` | Optional npub/hex allowlist. Without it the first login is the owner (Settings → Access) |
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
- Software wallets' recovery words are stored only encrypted with their password; a stolen database can't spend.
  Watch-only wallets can't sign. `.env` and `data/` are git-ignored.

## Layout

```
app/                 pages (dashboard, send, receive, transactions, utxos, settings) and API routes
components/          UI (shadcn/ui), providers, QR
lib/wallet.ts        shared types and address helpers
lib/tx.ts            coin selection, fee policies, PSBT building, per-chain output rules
lib/unified-sighash.ts  SIGHASH_UNIFIED
lib/server/          wallets, seed encryption, auth, Electrum client, sync engine, signer, settings, labels (server-only)
prisma/              schema and migrations
scripts/check.ts     pnpm check
```
