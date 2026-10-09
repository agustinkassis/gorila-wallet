import "server-only"
import { Transaction } from "@scure/btc-signer"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { config } from "@/lib/server/config"
import { db } from "@/lib/server/db"
import { Electrum } from "@/lib/server/electrum"
import { getSettings } from "@/lib/server/settings"
import { listWallets } from "@/lib/server/wallets"
import { parseTxHex as parseTx } from "@/lib/tx"
import { CHAINS, CHAIN_IDS, syncedChains, type Chain, type Family } from "@/lib/chains"
import { addressScript, deriveAddress, scriptHash, type Account, type Fees, type Snapshot, type WalletInfo } from "@/lib/wallet"

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
 * One chain: a single Electrum connection shared by every wallet, plus chain-wide caches
 * (raw txs, block times, fee estimates). Scripthash notifications are routed to the wallets that own them.
 */
class ChainClient {
  readonly client: Electrum
  height = 0
  fees: Fees | null = null
  readonly syncs = new Map<string, WalletSync>()
  private routes = new Map<string, Set<WalletSync>>()
  private txCache = new Map<string, Promise<Transaction>>()
  private timeCache = new Map<number, Promise<number>>()
  private feeTimer?: NodeJS.Timeout

  readonly family: Family
  /** sources this client was started with: a change in Settings restarts it */
  readonly key: string

  constructor(
    readonly chain: Chain,
    urls: string[],
    /** mempool.space-compatible APIs, tried in order; the first one is the explorer */
    readonly mempool: string[],
  ) {
    this.family = CHAINS[chain].family
    this.key = JSON.stringify([urls, mempool])
    this.client = new Electrum(urls, {
      onConnect: () => {
        this.routes.clear() // subscriptions belong to the old connection
        void this.client
          .request<{ height: number }>("blockchain.headers.subscribe")
          .then((tip) => {
            this.height = tip.height
            for (const s of this.syncs.values()) s.reconnected()
          })
          .catch(() => {})
      },
      onDisconnect: () => this.syncs.forEach((s) => s.refreshMeta()),
      onNotify: (method, params) => {
        if (method === "blockchain.headers.subscribe") {
          const tip = params[0] as { height?: unknown } | undefined
          if (typeof tip?.height !== "number") return // malformed notification: servers are untrusted
          this.height = tip.height
          this.syncs.forEach((s) => s.refreshMeta())
        } else if (method === "blockchain.scripthash.subscribe") {
          this.routes.get(params[0] as string)?.forEach((s) => s.markDirty(params[0] as string, params[1] as string | null))
        }
      },
    })
    void this.pollFees()
    this.feeTimer = setInterval(() => void this.pollFees(), 60_000)
  }

  get connected() {
    return this.client.connected
  }

  /** Subscribe a wallet to a scripthash (several wallets may share one) and return its current status. */
  subscribe(sh: string, sync: WalletSync) {
    let set = this.routes.get(sh)
    if (!set) this.routes.set(sh, (set = new Set()))
    set.add(sync)
    return this.client.request<string | null>("blockchain.scripthash.subscribe", [sh])
  }

  unroute(sync: WalletSync) {
    for (const set of this.routes.values()) set.delete(sync)
  }

  stop() {
    clearInterval(this.feeTimer)
    this.syncs.forEach((s) => s.stop())
    this.syncs.clear()
    this.client.close()
  }

  /** Raw tx hex: SQLite cache first, then Electrum (and cache it — raw txs never change). */
  async rawHex(txid: string) {
    const where = { chain_txid: { chain: this.chain, txid } }
    const row = await db.rawTx.findUnique({ where })
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error("Invalid transaction ID")
    const hex = row?.hex ?? await this.client.request<string>("blockchain.transaction.get", [txid])
    // Recheck old cache entries too: older versions trusted arbitrary Electrum responses.
    if (typeof hex !== "string" || hex.length > 8_000_000 || parseTx(hex).id !== txid) throw new Error("Transaction ID mismatch")
    if (row) return hex
    await db.rawTx.upsert({ where, create: { chain: this.chain, txid, hex }, update: {} })
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
  blockTime(height: number) {
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

  /** mempool fee estimates (each source in turn); Electrum estimatefee as a fallback. */
  private async pollFees() {
    let fees: Fees | null = null
    for (const base of this.mempool) {
      try {
        const res = await fetch(`${base}/api/v1/fees/recommended`, { signal: AbortSignal.timeout(10_000) })
        if (res.ok) fees = await res.json()
      } catch {}
      if (fees) break
    }
    if (!fees && this.client.connected) {
      try {
        const est = await Promise.all([1, 3, 6, 25, 144].map((n) => this.client.request<number>("blockchain.estimatefee", [n])))
        const [fastestFee, halfHourFee, hourFee, economyFee, minimumFee] = est.map((btcPerKvb) => Math.max(1, Math.ceil(btcPerKvb * 1e5)))
        fees = { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }
      } catch {}
    }
    if (fees) {
      this.fees = fees
      this.syncs.forEach((s) => s.refreshMeta())
    }
  }
}

/**
 * One wallet on one chain, through its account on the chain's family. Electrum is the source of truth; SQLite is the
 * warm, indexed cache.
 * Electrum-style: subscribe every address, compare its status hash with the stored one, and only
 * resync addresses whose status changed. Gap-limit discovery on the receive and change branches.
 */
class WalletSync {
  snapshot: Snapshot
  private listeners = new Set<Listener>()
  /** scripthashes subscribed on the current connection */
  private subscribed = new Map<string, AddressRow>()
  /** scripthash -> latest status from Electrum, waiting to be synced */
  private dirty = new Map<string, string | null>()
  private scripts = new Set<string>()
  private running = false
  private again = false
  private stopped = false
  private debounce?: NodeJS.Timeout

  readonly account: Account

  constructor(
    readonly wallet: WalletInfo,
    readonly chain: ChainClient,
  ) {
    this.account = wallet.accounts[chain.family]!
    this.snapshot = {
      walletId: wallet.id,
      chain: chain.chain,
      connected: false,
      synced: false,
      server: null,
      height: 0,
      explorer: chain.mempool[0] ?? "",
      fees: null,
      addresses: [],
      utxos: [],
      txs: [],
    }
    void this.publish().catch(() => {}) // warm start: last known state from SQLite, before Electrum answers
    if (chain.connected) this.kick()
  }

  get walletId() {
    return this.wallet.id
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.debounce)
    this.listeners.clear()
    this.chain.unroute(this)
  }

  private emit(s: Snapshot) {
    if (this.stopped) return
    this.snapshot = s
    for (const l of this.listeners) l(s)
  }

  /** Connection, tip or fees changed: re-emit without touching the DB. */
  refreshMeta() {
    this.emit({
      ...this.snapshot,
      connected: this.chain.connected,
      server: this.chain.connected ? this.chain.client.server : this.snapshot.server,
      height: this.chain.height,
      fees: this.chain.fees,
    })
  }

  reconnected() {
    this.subscribed.clear()
    this.kick()
  }

  markDirty(sh: string, status: string | null) {
    this.dirty.set(sh, status)
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => this.kick(), 300)
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
        } while (this.again && !this.stopped)
      } catch {
        // connection dropped mid-sync: Electrum reconnects and kicks again
      } finally {
        this.running = false
      }
    })()
  }

  /**
   * Derive addresses until each branch has `gap` unused ones past the last used (on this chain or its replay pair,
   * which share addresses); subscribe new ones.
   */
  private async discover() {
    if (this.stopped) return false
    const walletId = this.walletId
    const family = this.chain.family
    const settings = await getSettings()
    const [rows, used, states] = await Promise.all([
      db.address.findMany({ where: { walletId, family } }),
      db.addressState.findMany({ where: { walletId, chain: { in: syncedChains(this.chain.chain) }, used: true }, select: { address: true } }),
      db.addressState.findMany({ where: { walletId, chain: this.chain.chain }, select: { address: true, status: true } }),
    ])
    const usedSet = new Set(used.map((u) => u.address))
    const all: AddressRow[] = [...rows]
    let added = false
    for (const change of [0, 1] as const) {
      const branch = all.filter((r) => r.change === change)
      const lastUsed = Math.max(-1, ...branch.filter((r) => usedSet.has(r.address)).map((r) => r.index))
      const want = lastUsed + 1 + (change ? settings.gapChange : settings.gapReceive)
      for (let index = branch.length; index < want; index++) {
        const { address } = deriveAddress(this.account.xpub, change, index, family)
        const row = { address, change, index, scripthash: scriptHash(address, family) }
        // a family's chains (Bitcoin and Blake) derive the same rows for a wallet
        await db.address.upsert({ where: { walletId_address: { walletId, address } }, create: { walletId, family, ...row }, update: {} })
        all.push(row)
        added = true
      }
    }
    const stored = new Map(states.map((s) => [s.address, s.status]))
    const fresh = all.filter((a) => !this.subscribed.has(a.scripthash))
    await Promise.all(
      fresh.map(async (a) => {
        this.subscribed.set(a.scripthash, a)
        this.scripts.add(bytesToHex(addressScript(a.address, family)))
        const status = await this.chain.subscribe(a.scripthash, this)
        if (!stored.has(a.address) || stored.get(a.address) !== status) this.dirty.set(a.scripthash, status)
      }),
    )
    return added
  }

  /** Refetch only addresses whose Electrum status changed, then write everything in one DB transaction. */
  private async syncDirty() {
    const batch = [...this.dirty].filter(([sh]) => this.subscribed.has(sh))
    this.dirty.clear()
    if (!batch.length || this.stopped) return
    const c = this.chain.client
    const chain = this.chain.chain
    const walletId = this.walletId
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
          walletId,
          chain,
          txid,
          height,
          time: height > 0 ? await this.chain.blockTime(height) : null,
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
              where: { walletId_chain_address: { walletId, chain, address: r.address } },
              create: { walletId, chain, address: r.address, ...state },
              update: state,
            }),
            db.utxo.deleteMany({ where: { walletId, chain, address: r.address } }),
            db.utxo.createMany({
              data: r.unspent.map((u) => ({ walletId, chain, txid: u.tx_hash, vout: u.tx_pos, address: r.address, value: BigInt(u.value), height: u.height })),
            }),
          ]
        }),
        ...txRows.map((t) => db.tx.upsert({ where: { walletId_chain_txid: { walletId, chain, txid: t.txid } }, create: t, update: t })),
      ])
      // Drop txs no address references any more (replaced by RBF or evicted from the mempool).
      const histories = await db.addressState.findMany({ where: { walletId, chain }, select: { history: true } })
      const live = histories.flatMap((h) => (JSON.parse(h.history) as [string, number][]).map(([txid]) => txid))
      await db.tx.deleteMany({ where: { walletId, chain, txid: { notIn: live } } })
    } catch (e) {
      for (const [sh, status] of batch) if (!this.dirty.has(sh)) this.dirty.set(sh, status) // retry next pass
      throw e
    }
  }

  /** Net effect on this wallet's scripts, fee and vsize. Parents come from the chain's raw-tx cache. */
  private async describe(txid: string) {
    const tx = await this.chain.getTx(txid)
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
      const prev = (await this.chain.getTx(prevHex)).getOutput(index)
      if (totalIn !== null) totalIn += prev.amount ?? 0n
      if (prev.script && this.scripts.has(bytesToHex(prev.script))) amount -= prev.amount ?? 0n
    }
    return { amount, fee: totalIn === null ? null : totalIn - totalOut, vsize: tx.vsize }
  }

  /** Rebuild the snapshot from SQLite (labels and frozen flags joined in) and broadcast it. */
  async publish() {
    if (this.stopped) return
    const chain = this.chain.chain
    const walletId = this.walletId
    const [addresses, states, utxos, txs, labels] = await Promise.all([
      db.address.findMany({ where: { walletId, family: this.chain.family }, orderBy: [{ change: "asc" }, { index: "asc" }] }),
      db.addressState.findMany({ where: { walletId, chain } }),
      db.utxo.findMany({ where: { walletId, chain }, orderBy: { value: "desc" } }),
      db.tx.findMany({ where: { walletId, chain } }),
      db.label.findMany({ where: { walletId, chain: { in: [chain, "all"] } } }),
    ])
    const state = new Map(states.map((s) => [s.address, s]))
    const label = new Map(labels.map((l) => [`${l.type}:${l.ref}`, l]))
    this.emit({
      ...this.snapshot,
      connected: this.chain.connected,
      server: this.chain.connected ? this.chain.client.server : this.snapshot.server,
      height: this.chain.height || this.snapshot.height,
      fees: this.chain.fees,
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

export type { ChainClient, WalletSync }

// Survive dev hot reloads: one ChainClient (one Electrum socket) per chain per process.
const g = globalThis as typeof globalThis & { chains?: Partial<Record<Chain, ChainClient>>; syncListeners?: Set<() => void> }
const changeListeners = (g.syncListeners ??= new Set())

export class ChainInactiveError extends Error {
  constructor(chain: Chain) {
    super(`${CHAINS[chain].label} isn't the selected network: switch to it in the navbar`)
  }
}

/** Active chain clients right now (no I/O): the selected network and its replay pair. */
export const currentChains = (): Partial<Record<Chain, ChainClient>> => g.chains ?? {}
/** Every active wallet sync, across chains. */
export const currentSyncs = () => Object.values(currentChains()).flatMap((c) => [...c!.syncs.values()])

/** Notified when a chain or wallet sync starts or stops (the SSE stream re-subscribes). */
export const onSyncsChange = (l: () => void) => (changeListeners.add(l), () => void changeListeners.delete(l))

/**
 * Start/stop chain clients and per-wallet syncs to match the selected network (plus its replay pair), each chain's
 * sources and the wallet list. Wallets sync on a chain when they have an account on its family.
 */
export async function syncWatchers() {
  const [settings, wallets] = await Promise.all([getSettings(), listWallets()])
  const chains = (g.chains ??= {})
  const want = syncedChains(settings.chain)
  let changed = false
  for (const chain of CHAIN_IDS) {
    const { electrum, mempool } = config.sources(chain, settings)
    const running = chains[chain]
    if (running && (!want.includes(chain) || running.key !== JSON.stringify([electrum, mempool]))) {
      running.stop()
      delete chains[chain]
      changed = true
    }
    if (want.includes(chain) && !chains[chain]) {
      chains[chain] = new ChainClient(chain, electrum, mempool)
      changed = true
    }
    const client = chains[chain]
    if (!client) continue
    for (const [id, sync] of client.syncs) {
      const w = wallets.find((x) => x.id === id)
      if (w?.accounts[client.family]?.xpub !== sync.account.xpub) {
        sync.stop()
        client.syncs.delete(id)
        changed = true
      }
    }
    for (const w of wallets)
      if (w.accounts[client.family] && !client.syncs.has(w.id)) {
        client.syncs.set(w.id, new WalletSync(w, client))
        changed = true
      }
  }
  if (changed) for (const l of changeListeners) l()
  return chains
}

/** The chain client, or ChainInactiveError when that chain isn't synced (another network is selected). */
export async function chainFor(chain: Chain) {
  const c = (await syncWatchers())[chain]
  if (!c) throw new ChainInactiveError(chain)
  return c
}

/** A wallet's sync on a chain. */
export async function syncFor(walletId: string, chain: Chain) {
  const s = (await chainFor(chain)).syncs.get(walletId)
  if (!s) throw new Error("This wallet has no account on that network")
  return s
}
