import { HDKey } from "@scure/bip32"
import { Address, NETWORK, OutScript, p2wpkh } from "@scure/btc-signer"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"

export type Chain = "btc" | "xbt"

export const CHAINS: Record<Chain, { label: string; unit: string; text: string; bg: string }> = {
  btc: { label: "Bitcoin", unit: "BTC", text: "text-orange-400", bg: "bg-orange-500" },
  xbt: { label: "Blake", unit: "XBT", text: "text-violet-400", bg: "bg-violet-500" },
}
export const CHAIN_IDS = Object.keys(CHAINS) as Chain[]

/** Addresses shown on the dashboard (receive chain). Discovery goes further, up to the gap limit. */
export const ADDRESS_COUNT = 10

export type AddressInfo = {
  address: string
  change: 0 | 1
  index: number
  used: boolean
  confirmed: number
  unconfirmed: number
  label?: string
}
export type Utxo = { txid: string; vout: number; address: string; value: number; height: number; frozen: boolean; label?: string }
export type Tx = { txid: string; height: number; time: number | null; amount: number; fee?: number | null; vsize?: number | null; label?: string }
export type Fees = { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number }

export type Snapshot = {
  chain: Chain
  connected: boolean
  /** true once balances come from a completed sync (now or a previous run, via the local DB) */
  synced: boolean
  /** host:port of the Electrum server in use */
  server: string | null
  height: number
  /** mempool explorer base URL for this chain */
  explorer: string
  fees: Fees | null
  addresses: AddressInfo[]
  utxos: Utxo[]
  txs: Tx[]
}

export type FeePreset = keyof Fees
export type Settings = {
  /** Blake2b extension: track and spend the BLAKE2b fork (XBT) */
  blake: boolean
  sound: boolean
  notifications: boolean
  feePreset: FeePreset
  /** BTC sends: OP_RETURN replay guard on by default */
  replayGuard: boolean
  gapReceive: number
  gapChange: number
}
export const DEFAULT_SETTINGS: Settings = {
  blake: true,
  sound: true,
  notifications: true,
  feePreset: "halfHourFee",
  replayGuard: false,
  gapReceive: 20,
  gapChange: 10,
}

export type StreamMessage =
  | { type: "init"; xpub: string; path: string; fingerprint: number }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "settings"; settings: Settings }

export function deriveAddress(xpub: string, change: 0 | 1, index: number) {
  const key = HDKey.fromExtendedKey(xpub).deriveChild(change).deriveChild(index)
  return { address: p2wpkh(key.publicKey!).address!, publicKey: key.publicKey! }
}

export function deriveAddresses(xpub: string, count = ADDRESS_COUNT, change: 0 | 1 = 0) {
  const branch = HDKey.fromExtendedKey(xpub).deriveChild(change)
  return Array.from({ length: count }, (_, i) => p2wpkh(branch.deriveChild(i).publicKey!).address!)
}

export const addressScript = (address: string) => OutScript.encode(Address(NETWORK).decode(address))

// Electrum scripthash: sha256(scriptPubKey), byte-reversed hex.
export const scriptHash = (address: string) => bytesToHex(sha256(addressScript(address)).reverse())

export const formatCoins = (sats: number) => (sats / 1e8).toFixed(8)

export const sumBalances = (s?: Snapshot) =>
  (s?.addresses ?? []).reduce(
    (acc, b) => ({ confirmed: acc.confirmed + b.confirmed, unconfirmed: acc.unconfirmed + b.unconfirmed }),
    { confirmed: 0, unconfirmed: 0 },
  )

/** Snapshot has real data (kept while reconnecting, so last known values stay visible). */
export const hasData = (s?: Snapshot): s is Snapshot => !!s?.synced

/** Outpoints present on both chains: pre-fork coins whose normal BTC spend can be replayed on Blake. */
export function sharedOutpoints(snapshots: Partial<Record<Chain, Snapshot>>) {
  const xbt = new Set((snapshots.xbt?.utxos ?? []).map((u) => `${u.txid}:${u.vout}`))
  return new Set((snapshots.btc?.utxos ?? []).map((u) => `${u.txid}:${u.vout}`).filter((o) => xbt.has(o)))
}

/** First address on a branch that is unused on every chain. */
export function nextUnused(snapshots: Partial<Record<Chain, Snapshot>>, change: 0 | 1) {
  const used = new Set(Object.values(snapshots).flatMap((s) => s?.addresses.filter((a) => a.used).map((a) => a.address) ?? []))
  const all = (snapshots.btc ?? snapshots.xbt)?.addresses.filter((a) => a.change === change) ?? []
  return all.sort((a, b) => a.index - b.index).find((a) => !used.has(a.address))
}

export type TxEvent = { kind: "received" | "confirmed"; chain: Chain; tx: Tx }

/** Incoming-funds events between two snapshots of one chain. The first load is a baseline and emits nothing. */
export function txEvents(prev: Snapshot | undefined, next: Snapshot): TxEvent[] {
  if (!hasData(prev) || !hasData(next)) return []
  const before = new Map(prev.txs.map((t) => [t.txid, t.height]))
  return next.txs
    .filter((tx) => tx.amount > 0)
    .flatMap((tx): TxEvent[] => {
      const height = before.get(tx.txid)
      if (height === undefined) return [{ kind: "received", chain: next.chain, tx }]
      if (height <= 0 && tx.height > 0) return [{ kind: "confirmed", chain: next.chain, tx }]
      return []
    })
}

/** Unconfirmed incoming txs across chains (drives the sidebar dot). */
export const pendingIncoming = (snapshots: Partial<Record<Chain, Snapshot>>) =>
  Object.values(snapshots).flatMap((s) => s?.txs.filter((t) => t.amount > 0 && t.height <= 0) ?? [])

/** "0.0015" → 150000 sats, exactly (no float rounding). null when not a valid amount. */
export function parseCoins(input: string): number | null {
  const m = /^\s*(\d*)(?:\.(\d{0,8}))?\s*$/.exec(input)
  if (!m || (!m[1] && !m[2])) return null
  const sats = Number(m[1] || "0") * 1e8 + Number((m[2] ?? "").padEnd(8, "0"))
  return Number.isSafeInteger(sats) ? sats : null
}
