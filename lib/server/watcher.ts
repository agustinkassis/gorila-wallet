import "server-only"
import { Transaction } from "@scure/btc-signer"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { db } from "@/lib/server/db"
import { Electrum } from "@/lib/server/electrum"
import { getAccount } from "@/lib/server/keys"
import { getSettings } from "@/lib/server/settings"
import { parseTxHex as parseTx } from "@/lib/tx"
import { addressScript, deriveAddress, scriptHash, type Chain, type Fees, type Snapshot } from "@/lib/wallet"

type Listener = (s: Snapshot) => void
type HistoryItem = { tx_hash: string; height: number }
type Unspent = { tx_hash: string; tx_pos: number; height: number; value: number }
type Balance = { confirmed: number; unconfirmed: number }
type AddressRow = { address: string; change: number; index: number; scripthash: string }

/** Block header timestamp: 4-byte LE at offset 68 (same in Bitcoin's 80-byte and Blake's 164-byte headers). */
export const headerTime = (hex: string) => new DataView(hexToBytes(hex).buffer).getUint32(68, true)

export { parseTxHex as parseTx } from "@/lib/tx"
const COINBASE = "0".repeat(64)

/**
 * One chain's sync engine. Electrum is the source of truth; SQLite is the warm, indexed cache.
 * Electrum-style: subscribe every address, compare its status hash with the stored one, and only
 * resync addresses whose status changed. Gap-limit discovery on the receive and change branches.
 */
class Watcher {
  snapshot: Snapshot
  readonly client: Electrum
  private listeners = new Set<Listener>()
  /** scripthash -> address, for this connection's subscriptions */
  private subscribed = new Map<string, AddressRow>()
  /** scripthash -> latest status from Electrum, waiting to be synced */
  private dirty = new Map<string, string | null>()
  private scripts = new Set<string>()
  private txCache = new Map<string, Promise<Transaction>>()
  private timeCache = new Map<number, Promise<number>>()
  private running = false
  private again = false
  private debounce?: NodeJS.Timeout
  private feeTimer?: NodeJS.Timeout

  constructor(
    readonly chain: Chain,
    urls: string[],
    readonly mempool: string,
  ) {
    this.snapshot = {
      chain,
      connected: false,
      synced: false,
      server: null,
      height: 0,
      explorer: mempool,
      fees: null,
      addresses: [],
      utxos: [],
      txs: [],
    }
    this.client = new Electrum(urls, {
      onConnect: () => {
        this.subscribed.clear()
        void this.client
          .request<{ height: number }>("blockchain.headers.subscribe")
          .then((tip) => {
            this.snapshot.height = tip.height
            this.kick()
          })
          .catch(() => {})
      },
      onDisconnect: () => this.emit({ ...this.snapshot, connected: false }),
      onNotify: (method, params) => {
        if (method === "blockchain.headers.subscribe") {
          this.emit({ ...this.snapshot, height: (params[0] as { height: number }).height })
        } else if (method === "blockchain.scripthash.subscribe") {
          this.dirty.set(params[0] as string, params[1] as string | null)
          clearTimeout(this.debounce)
          this.debounce = setTimeout(() => this.kick(), 300)
        }
      },
    })
    void this.publish().catch(() => {}) // warm start: last known state from SQLite, before Electrum answers
    void this.pollFees()
    this.feeTimer = setInterval(() => void this.pollFees(), 60_000)
  }

  /** Shut down (extension disabled). Cached data stays in SQLite for a warm restart. */
  stop() {
    clearInterval(this.feeTimer)
    clearTimeout(this.debounce)
    this.listeners.clear()
    this.client.close()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private emit(s: Snapshot) {
    this.snapshot = s
    for (const l of this.listeners) l(s)
  }

  /** Discovery + sync loop. Single-flight: notifications during a run just schedule another pass. */
  kick() {
    if (this.running) return void (this.again = true)
    this.running = true
    void (async () => {
      try {
        do {
          this.again = false
          const added = await this.discover()
          await this.syncDirty()
          if (added) this.again = true // new addresses may be used: re-check the gap after syncing them
          await this.publish()
        } while (this.again)
      } catch {
        // connection dropped mid-sync: Electrum reconnects and kicks again
      } finally {
        this.running = false
      }
    })()
  }

  /** Derive addresses until each branch has `gap` unused ones past the last used (on any chain); subscribe new ones. */
  private async discover() {
    const { xpub } = getAccount()
    const settings = await getSettings()
    const [rows, used, states] = await Promise.all([
      db.address.findMany(),
      db.addressState.findMany({ where: { used: true }, select: { address: true } }),
      db.addressState.findMany({ where: { chain: this.chain }, select: { address: true, status: true } }),
    ])
    const usedSet = new Set(used.map((u) => u.address))
    const all: AddressRow[] = [...rows]
    let added = false
    for (const change of [0, 1] as const) {
      const branch = all.filter((r) => r.change === change)
      const lastUsed = Math.max(-1, ...branch.filter((r) => usedSet.has(r.address)).map((r) => r.index))
      const want = lastUsed + 1 + (change ? settings.gapChange : settings.gapReceive)
      for (let index = branch.length; index < want; index++) {
        const { address } = deriveAddress(xpub, change, index)
        const row = { address, change, index, scripthash: scriptHash(address) }
        await db.address.upsert({ where: { address }, create: row, update: {} }) // both chains derive the same rows
        all.push(row)
        added = true
      }
    }
    const stored = new Map(states.map((s) => [s.address, s.status]))
    const fresh = all.filter((a) => !this.subscribed.has(a.scripthash))
    await Promise.all(
      fresh.map(async (a) => {
        this.subscribed.set(a.scripthash, a)
        this.scripts.add(bytesToHex(addressScript(a.address)))
        const status = await this.client.request<string | null>("blockchain.scripthash.subscribe", [a.scripthash])
        if (!stored.has(a.address) || stored.get(a.address) !== status) this.dirty.set(a.scripthash, status)
      }),
    )
    return added
  }

  /** Refetch only addresses whose Electrum status changed, then write everything in one DB transaction. */
  private async syncDirty() {
    const batch = [...this.dirty]
    this.dirty.clear()
    if (!batch.length) return
    const c = this.client
    const chain = this.chain
    try {
      const results = await Promise.all(
        batch.map(async ([sh, status]) => {
          const [history, unspent, balance] = await Promise.all([
            c.request<HistoryItem[]>("blockchain.scripthash.get_history", [sh]),
            c.request<Unspent[]>("blockchain.scripthash.listunspent", [sh]),
            c.request<Balance>("blockchain.scripthash.get_balance", [sh]),
          ])
          return { address: this.subscribed.get(sh)!.address, status, history, unspent, balance }
        }),
      )
      const heights = new Map(results.flatMap((r) => r.history.map((h) => [h.tx_hash, h.height] as const)))
      const txRows = await Promise.all(
        [...heights].map(async ([txid, height]) => ({
          chain,
          txid,
          height,
          time: height > 0 ? await this.blockTime(height) : null,
          ...(await this.describe(txid)),
        })),
      )
      await db.$transaction([
        ...results.flatMap((r) => {
          const state = {
            status: r.status,
            used: r.history.length > 0,
            confirmed: BigInt(r.balance.confirmed),
            unconfirmed: BigInt(r.balance.unconfirmed),
            history: JSON.stringify(r.history.map((h) => [h.tx_hash, h.height])),
          }
          return [
            db.addressState.upsert({
              where: { chain_address: { chain, address: r.address } },
              create: { chain, address: r.address, ...state },
              update: state,
            }),
            db.utxo.deleteMany({ where: { chain, address: r.address } }),
            db.utxo.createMany({
              data: r.unspent.map((u) => ({ chain, txid: u.tx_hash, vout: u.tx_pos, address: r.address, value: BigInt(u.value), height: u.height })),
            }),
          ]
        }),
        ...txRows.map((t) => db.tx.upsert({ where: { chain_txid: { chain, txid: t.txid } }, create: t, update: t })),
      ])
      // Drop txs no address references any more (replaced by RBF or evicted from the mempool).
      const histories = await db.addressState.findMany({ where: { chain }, select: { history: true } })
      const live = histories.flatMap((h) => (JSON.parse(h.history) as [string, number][]).map(([txid]) => txid))
      await db.tx.deleteMany({ where: { chain, txid: { notIn: live } } })
    } catch (e) {
      for (const [sh, status] of batch) if (!this.dirty.has(sh)) this.dirty.set(sh, status) // retry next pass
      throw e
    }
  }

  /** Net effect on our scripts, fee and vsize. Parents come from the raw-tx cache (fetched once, kept forever). */
  private async describe(txid: string) {
    const tx = await this.getTx(txid)
    let amount = 0n
    let totalOut = 0n
    let totalIn: bigint | null = 0n
    for (let i = 0; i < tx.outputsLength; i++) {
      const out = tx.getOutput(i)
      totalOut += out.amount ?? 0n
      if (out.script && this.scripts.has(bytesToHex(out.script))) amount += out.amount ?? 0n
    }
    for (let i = 0; i < tx.inputsLength; i++) {
      const { txid: prevId, index } = tx.getInput(i)
      const prevHex = prevId ? bytesToHex(prevId) : COINBASE
      if (prevHex === COINBASE || index === undefined) {
        totalIn = null
        continue
      }
      const prev = (await this.getTx(prevHex)).getOutput(index)
      if (totalIn !== null) totalIn += prev.amount ?? 0n
      if (prev.script && this.scripts.has(bytesToHex(prev.script))) amount -= prev.amount ?? 0n
    }
    return { amount, fee: totalIn === null ? null : totalIn - totalOut, vsize: tx.vsize }
  }

  /** Raw tx hex: SQLite cache first, then Electrum (and cache it — raw txs never change). */
  async rawHex(txid: string) {
    const row = await db.rawTx.findUnique({ where: { chain_txid: { chain: this.chain, txid } } })
    if (row) return row.hex
    const hex = await this.client.request<string>("blockchain.transaction.get", [txid])
    await db.rawTx.upsert({ where: { chain_txid: { chain: this.chain, txid } }, create: { chain: this.chain, txid, hex }, update: {} })
    return hex
  }

  getTx(txid: string) {
    let p = this.txCache.get(txid)
    if (!p) {
      p = this.rawHex(txid).then(parseTx)
      p.catch(() => this.txCache.delete(txid))
      this.txCache.set(txid, p)
    }
    return p
  }

  // ponytail: cached by height only; a reorg changes a timestamp by minutes at most.
  private blockTime(height: number) {
    let p = this.timeCache.get(height)
    if (!p) {
      p = (async () => {
        const where = { chain_height: { chain: this.chain, height } }
        const row = await db.header.findUnique({ where })
        if (row) return row.time
        const time = headerTime(await this.client.request<string>("blockchain.block.header", [height]))
        await db.header.upsert({ where, create: { chain: this.chain, height, time }, update: {} })
        return time
      })()
      p.catch(() => this.timeCache.delete(height))
      this.timeCache.set(height, p)
    }
    return p
  }

  /** mempool fee estimates; Electrum estimatefee as a fallback. */
  private async pollFees() {
    let fees: Fees | null = null
    try {
      const res = await fetch(`${this.mempool}/api/v1/fees/recommended`, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) fees = await res.json()
    } catch {}
    if (!fees && this.client.connected) {
      try {
        const est = await Promise.all([1, 3, 6, 25, 144].map((n) => this.client.request<number>("blockchain.estimatefee", [n])))
        const [fastestFee, halfHourFee, hourFee, economyFee, minimumFee] = est.map((btcPerKvb) => Math.max(1, Math.ceil(btcPerKvb * 1e5)))
        fees = { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }
      } catch {}
    }
    if (fees) this.emit({ ...this.snapshot, fees })
  }

  /** Rebuild the snapshot from SQLite (labels and frozen flags joined in) and broadcast it. */
  async publish() {
    const chain = this.chain
    const [addresses, states, utxos, txs, labels] = await Promise.all([
      db.address.findMany({ orderBy: [{ change: "asc" }, { index: "asc" }] }),
      db.addressState.findMany({ where: { chain } }),
      db.utxo.findMany({ where: { chain }, orderBy: { value: "desc" } }),
      db.tx.findMany({ where: { chain } }),
      db.label.findMany({ where: { chain: { in: [chain, "all"] } } }),
    ])
    const state = new Map(states.map((s) => [s.address, s]))
    const label = new Map(labels.map((l) => [`${l.type}:${l.ref}`, l]))
    this.emit({
      ...this.snapshot,
      connected: this.client.connected,
      server: this.client.connected ? this.client.server : this.snapshot.server,
      synced: states.length > 0,
      addresses: addresses.map((a) => {
        const s = state.get(a.address)
        return {
          address: a.address,
          change: a.change as 0 | 1,
          index: a.index,
          used: !!s?.used,
          confirmed: Number(s?.confirmed ?? 0),
          unconfirmed: Number(s?.unconfirmed ?? 0),
          label: label.get(`addr:${a.address}`)?.label ?? undefined,
        }
      }),
      utxos: utxos.map((u) => {
        const l = label.get(`output:${u.txid}:${u.vout}`)
        return {
          txid: u.txid,
          vout: u.vout,
          address: u.address,
          value: Number(u.value),
          height: u.height,
          frozen: l?.spendable === false,
          label: l?.label ?? undefined,
        }
      }),
      txs: txs.map((t) => ({
        txid: t.txid,
        height: t.height,
        time: t.time,
        amount: Number(t.amount),
        fee: t.fee === null ? null : Number(t.fee),
        vsize: t.vsize,
        label: label.get(`tx:${t.txid}`)?.label ?? undefined,
      })),
    })
  }
}

export type { Watcher }

/** Comma-separated list of tcp:// or ssl:// Electrum URLs, tried in order. */
const servers = (list: string) => list.split(",").map((u) => u.trim()).filter(Boolean)

// Survive dev hot reloads: one watcher (and one Electrum socket) per chain per process.
const g = globalThis as typeof globalThis & { watchers?: Partial<Record<Chain, Watcher>>; watcherListeners?: Set<() => void> }
const changeListeners = (g.watcherListeners ??= new Set())

export class ExtensionDisabledError extends Error {
  constructor() {
    super("The Blake2b extension is disabled")
  }
}

/** Active watchers right now (no I/O): Bitcoin always, Blake while the Blake2b extension is on. */
export const currentWatchers = (): Partial<Record<Chain, Watcher>> => g.watchers ?? {}

/** Notified when a watcher starts or stops (the SSE stream re-subscribes). */
export const onWatchersChange = (l: () => void) => (changeListeners.add(l), () => void changeListeners.delete(l))

/** Start/stop watchers to match settings: Bitcoin is core, Blake (XBT) is the Blake2b extension. */
export async function syncWatchers() {
  getAccount() // fail fast when the wallet isn't configured
  const { blake } = await getSettings()
  const w = (g.watchers ??= {})
  let changed = false
  if (!w.btc) {
    w.btc = new Watcher(
      "btc",
      servers(process.env.BTC_ELECTRUM || "ssl://electrum.blockstream.info:50002"),
      process.env.MEMPOOL_BTC_URL || "https://mempool.space",
    )
    changed = true
  }
  if (blake && !w.xbt) {
    w.xbt = new Watcher(
      "xbt",
      servers(process.env.XBT_ELECTRUM || "tcp://fulcrum.kilombino.com:17717"),
      process.env.MEMPOOL_XBT_URL || "https://mempool.kilombino.com",
    )
    changed = true
  } else if (!blake && w.xbt) {
    w.xbt.stop()
    delete w.xbt
    changed = true
  }
  if (changed) for (const l of changeListeners) l()
  return w
}

/** The watcher for `chain`, or ExtensionDisabledError when that chain's extension is off. */
export async function watcherFor(chain: Chain) {
  const w = (await syncWatchers())[chain]
  if (!w) throw new ExtensionDisabledError()
  return w
}
