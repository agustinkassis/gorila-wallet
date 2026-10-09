# 🦍 Gorilla Wallet

A self-hosted, multi-wallet Bitcoin wallet with Nostr login, coin control, several networks (Bitcoin, the
**Blake2b (XBT)** fork, Testnet4, Testnet3, Signet) and a desktop app for macOS, Windows and Linux.

Keys live only on your server. The browser gets each wallet's xpub (to derive addresses and build unsigned PSBTs)
and asks the backend to sign over [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md)
authenticated requests from allowed Nostr pubkeys. It runs with an **empty `.env`**.

## Download

Desktop builds are on the [Releases](https://github.com/agustinkassis/gorila-wallet/releases) page:

| System | File |
|---|---|
| macOS, Apple silicon (M-series) | `Gorilla.Wallet_<version>_aarch64.dmg` |
| macOS, Intel | `Gorilla.Wallet_<version>_x64.dmg` |
| Windows (x64 / ARM64) | `Gorilla.Wallet_<version>_x64-setup.exe` / `_arm64-setup.exe` |
| Linux, Intel/AMD | `Gorilla.Wallet_<version>_amd64.AppImage` (standalone), `_amd64.deb`, `.x86_64.rpm` |
| Linux, ARM64 | `Gorilla.Wallet_<version>_aarch64.AppImage` (standalone), `_arm64.deb`, `.aarch64.rpm` |

The builds aren't signed yet: on macOS open it once via System Settings → Privacy & Security → Open Anyway; on Windows
choose More info → Run anyway; on Linux `chmod +x` the AppImage and run it.

## Run it locally

Requires [git](https://git-scm.com), **Node 24** (see `.nvmrc`; [nvm](https://github.com/nvm-sh/nvm) makes it easy)
and [pnpm](https://pnpm.io) (`corepack enable` sets it up).

```bash
git clone https://github.com/agustinkassis/gorila-wallet.git
cd gorila-wallet
nvm use               # Node 24
pnpm install          # also generates the Prisma client
pnpm dev              # applies migrations, starts on http://localhost:3000
```

Open http://localhost:3000, connect your Nostr extension (the first login claims the app), then create or import a
wallet. For a production server: `pnpm build && pnpm start`. To build the desktop app instead, see
[Desktop app](#desktop-app).

## Wallets

Switch wallets from the top of the sidebar; add more with **Add wallet** (Sparrow-style):

- **Create**: new 12/24 recovery words generated in the browser, a backup check, optional BIP39 passphrase.
- **Import words**: restore from existing BIP39 words (live word and checksum validation).
- **Watch-only**: an xpub/zpub (mainnet) or tpub/vpub (testnets), with optional path and master fingerprint. Shown
  with a *Watch-only* badge; every send action is disabled.
- **`.env` wallet**: `SEED_PHRASE` (optional) appears as the default wallet; its seed is never stored.

Software wallets keep their recovery words in SQLite **encrypted with the wallet's password**
(scrypt N=2¹⁶ + AES-256-GCM). The password is asked for at signing time and the seed is decrypted in memory
for that signature only. The password is optional: without one the words are stored unencrypted and signing asks
for nothing. Every wallet syncs in the background over one shared Electrum connection per chain.

Each wallet has an account per family of networks: mainnet (Bitcoin, Blake) at `m/84'/0'/0'` and testnets (Testnet4,
Testnet3, Signet) at `m/84'/1'/0'`, like Sparrow and Electrum. New wallets get both; a password-protected wallet from
an earlier version asks for its password once to enable testnets.

## Networks

Pick the network in the navbar (top right): **Bitcoin**, **Blake**, **Testnet4**, **Testnet3** or **Signet**, one at a
time. A fork's replay pair syncs along in the background (on Bitcoin, Blake too; on Blake, Bitcoin), so replay checks
and the OP_RETURN guard always have both chains.

Every chain is data in [`lib/chains.ts`](lib/chains.ts): address family, colors, default sources, and features such as
SIGHASH_UNIFIED replay protection, consensus output limits and its replay pair. Adding a chain is adding an entry.
Each chain can use several Electrum servers and mempool.space-compatible explorers, tried in order: edit them in
**Settings → Networks** (or reset to the defaults), or set `<CHAIN>_ELECTRUM` / `MEMPOOL_<CHAIN>_URL` in `.env`.

## Features

- **Nostr login** (NIP-07 extension), avatar in the navbar, NIP-98 + allowlist on every API call
- **Live balances and transactions** over SSE from Electrum/Fulcrum subscriptions, with server failover
- **Send**: batch recipients, Send max, coin control (auto-suggested UTXOs), fee manager with mempool estimates
- **Review → Sign → Broadcast** modal: unsigned PSBT as animated QR (UR `crypto-psbt`, BBQr, base64, `.psbt`); sign here,
  or bring back a tx **signed on another device** (scan UR/BBQr with the camera, paste, or load `.psbt`/`.txn`), which is
  finalized and verified against the reviewed transaction (same txid, valid signatures, `0x21` on Blake); then broadcast
- **Fee bumping**: RBF (redesign the replacement: add coins, change amounts, take the fee from the payment) and CPFP
- **Replay** (Bitcoin ↔ Blake): analyze rebroadcasting any transaction in your history on the other chain, including
  incoming ones that spend someone else's coins, with an inputs → tx → outputs graph and the reason it works or not,
  then broadcast it
- **Networks**: Bitcoin, Blake, Testnet4, Testnet3 and Signet from the navbar, with editable sources per chain
- **Sats / BTC switch** in the navbar: every amount in the app in sats or in coins
- **Coin control**: freeze / unfreeze, labels on coins, addresses and txs, BIP-329 export/import
- **Receive**: next unused address with QR, gap-limit discovery (20 receive / 10 change), change on the internal chain
- **Notifications**: toast, sound, animation and system notification on incoming payments and confirmations
- **Light / dark / system theme**, switched with a circular reveal; glass surfaces, page and list transitions
- **Local SQLite cache** (Prisma): addresses, UTXOs, txs, raw txs, block times, labels, settings; warm start, Electrum status-hash sync

## Blake2b (XBT)

Select **Blake** or **Bitcoin** in the navbar: the same keys are tracked on both chains of the BLAKE2b fork:

- Blake sends are signed with **SIGHASH_UNIFIED** (`ALL|UNIFIED = 0x21`, Bitcoin Knots v29.4.1+), which Bitcoin rejects:
  they can't be replayed to move your BTC. Verified against the 166 reference vectors in `scripts/vectors/`.
- Bitcoin sends can carry a **Bitcoin-only OP_RETURN** (≥ 84 bytes). Blake's consensus rejects OP_RETURNs over 83 bytes
  (until 2027-09-01), so the transaction can never confirm there. The send form warns when a BTC spend of pre-fork coins
  could be replayed on Blake.
- Blake transactions refuse OP_RETURN outputs and output scripts over 34 bytes (Blake consensus).
- **Replay analysis** checks, per input and output: the coin is unspent on the target chain (asked to its Electrum
  server, for anyone's coin), the signatures aren't SIGHASH_UNIFIED when going to Bitcoin, outputs fit the target's
  consensus rules, the locktime is final there, the tx isn't already there, and the fee against the target's estimates.
  Transactions spending someone else's coins can be replayed too (e.g. a payment you received, so you also get its
  Blake coins): those coins move exactly where their owner sent them on the source chain. The server re-runs the
  analysis and broadcasts the source chain's own bytes.

## Configuration

Copy `.env.example` to `.env` only to change a default.

| Variable | Purpose |
|---|---|
| `SEED_PHRASE` | Optional default wallet (BIP39). Never sent to the browser or stored |
| `DERIVATION_PATH` | Its account path, default `m/84'/0'/0'` (P2WPKH) |
| `ALLOWED_PUBKEYS` | Optional npub/hex allowlist. Without it the first login is the owner (Settings → Access) |
| `<CHAIN>_ELECTRUM` | Comma-separated `tcp://` / `ssl://` Electrum servers, tried in order (`BTC_ELECTRUM`, `XBT_ELECTRUM`, `TBTC4_ELECTRUM`, …). Settings → Networks overrides it |
| `MEMPOOL_<CHAIN>_URL` | mempool.space-compatible APIs: fees, broadcast, explorer links (`MEMPOOL_BTC_URL`, …) |
| `DATABASE_URL` | SQLite file (default `file:./data/wallet.db`) |

## Desktop app

`src-tauri/` wraps the app in [Tauri](https://tauri.app) for macOS, Windows and Linux. It bundles the Next.js server
(standalone) and Node, starts them on `localhost`, and keeps the database, `server.log` and the app's Nostr key in the
OS app-data folder (`com.gorillawallet.desktop`). Webviews have no NIP-07 extensions, so the app signs in with its own
device key (first launch claims it). No `.env` is read or bundled.

Building needs [Rust](https://rustup.rs) and, on Linux, `libwebkit2gtk-4.1-dev librsvg2-dev patchelf`:

```bash
pnpm tauri build      # installers in src-tauri/target/release/bundle/
```

Builds are native (Node and better-sqlite3 are bundled for the host), so each OS/arch builds on its own:
`.github/workflows/desktop.yml` builds macOS (arm64, x64), Windows (x64, arm64) and Linux (x64, arm64) as workflow
artifacts; a `v*` tag also creates a draft release. The installers are unsigned (macOS: ad-hoc), so the first launch
needs System Settings → Privacy & Security → Open Anyway on macOS, and More info → Run anyway on Windows. App icon gorilla:
[Twemoji](https://github.com/jdecked/twemoji), CC-BY 4.0.

## Scripts

| Command | |
|---|---|
| `pnpm dev` / `pnpm start` | Migrate, then run (dev / production) |
| `pnpm build` | Production build |
| `pnpm check` | Self-checks: SIGHASH_UNIFIED vectors, signing round trips, coin selection, fee math, NIP-98 |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Apply Prisma migrations |
| `pnpm tauri build` | Desktop app for this OS/arch (see above) |

## Security model

- The backend signs only inputs that are provably this wallet's coins (derivation path, fingerprint and script checked
  against the real parent transaction), refuses frozen coins and chain-rule violations, and caps fee rates.
- POST bodies are bound to the NIP-98 signature (`payload` tag). Each write event is accepted once, including across restarts; clients must sign a fresh event for retries.
- Electrum TLS verifies certificates. Self-signed deployments must configure a trusted CA (for example `NODE_EXTRA_CA_CERTS`); no certificate bypass is provided. Plain `tcp://` sources remain unauthenticated.
- Software wallets with a password store their recovery words only encrypted with it; a stolen database can't spend
  them. Wallets created without a password can be spent by anyone with the database.
  Watch-only wallets can't sign. `.env` and `data/` are git-ignored.

## Layout

```
app/                 pages (dashboard, send, receive, transactions, utxos, settings) and API routes
components/          UI (shadcn/ui), providers, QR
lib/chains.ts        chain registry: networks, address families, features, default sources
lib/wallet.ts        shared types and address helpers
lib/tx.ts            coin selection, fee policies, PSBT building, per-chain output rules
lib/unified-sighash.ts  SIGHASH_UNIFIED
lib/server/          wallets, seed encryption, auth, Electrum client, sync engine, signer, settings, labels (server-only)
prisma/              schema and migrations
scripts/check.ts     pnpm check
scripts/desktop.mjs  desktop bundle inputs (Next.js standalone server + Node sidecar)
src-tauri/           desktop app (Tauri)
```
