"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { nip98 } from "nostr-tools"
import { toast } from "sonner"
import { useNostr, waitForNostr } from "@/components/nostr-provider"
import { playChime, systemNotify } from "@/lib/notify"
import {
  CHAINS,
  DEFAULT_SETTINGS,
  deriveAddresses,
  formatCoins,
  hasData,
  txEvents,
  type Chain,
  type Settings,
  type Snapshot,
  type StreamMessage,
  type TxEvent,
} from "@/lib/wallet"

type WalletState = {
  xpub?: string
  path?: string
  /** master key fingerprint, for PSBT bip32Derivation */
  fingerprint?: number
  /** first receive addresses, derived in the browser from the xpub */
  addresses: string[]
  settings: Settings
  snapshots: Partial<Record<Chain, Snapshot>>
  /** true while the SSE stream is open */
  live: boolean
  error?: string
  /** last incoming payment, drives the balance-card animation (id changes per event) */
  flash?: { id: string; chain: Chain; amount: number }
}

const EMPTY: WalletState = { addresses: [], snapshots: {}, live: false, settings: DEFAULT_SETTINGS }
/** Chains the user has on: Bitcoin is core, Blake (XBT) comes with the Blake2b extension. */
export const enabledChains = (s: Settings): Chain[] => (s.blake ? ["btc", "xbt"] : ["btc"])

const Ctx = createContext<(WalletState & { chains: Chain[]; retry: () => void }) | null>(null)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Fatal extends Error {}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { pubkey } = useNostr()
  const [state, setState] = useState<WalletState & { owner?: string }>(EMPTY)
  const [attempt, setAttempt] = useState(0)
  const router = useRouter()
  // Latest snapshot per chain, read outside setState so notifications fire exactly once per event.
  const latest = useRef<Partial<Record<Chain, Snapshot>>>({})
  const settings = useRef(DEFAULT_SETTINGS)

  useEffect(() => {
    if (!pubkey) return
    const ac = new AbortController()
    latest.current = {}
    const set = (patch: Partial<WalletState> | ((s: WalletState) => Partial<WalletState>)) =>
      !ac.signal.aborted && setState((s) => ({ ...s, owner: pubkey, ...(typeof patch === "function" ? patch(s) : patch) }))

    const notify = ({ kind, chain, tx }: TxEvent) => {
      const amount = `+${formatCoins(tx.amount)} ${CHAINS[chain].unit}`
      const confirmed = tx.height > 0
      const title = kind === "confirmed" ? `${CHAINS[chain].label} payment confirmed` : `${CHAINS[chain].label} payment received`
      const body = kind === "confirmed" || !confirmed ? `${amount} · ${confirmed ? "1 confirmation" : "pending confirmation"}` : `${amount} · confirmed`
      const view = { label: "View", onClick: () => router.push("/transactions") }
      if (kind === "received") {
        toast.success(title, { description: body, action: view })
        if (settings.current.sound) playChime()
        set({ flash: { id: `${chain}:${tx.txid}`, chain, amount: tx.amount } })
      } else {
        toast.info(title, { description: body, action: view })
      }
      if (settings.current.notifications) systemNotify(title, body)
    }

    const onMessage = (msg: StreamMessage) => {
      if (msg.type === "init")
        return set({ xpub: msg.xpub, path: msg.path, fingerprint: msg.fingerprint, addresses: deriveAddresses(msg.xpub) })
      if (msg.type === "settings") {
        settings.current = msg.settings
        return set({ settings: msg.settings })
      }
      const { chain } = msg.snapshot
      const events = txEvents(latest.current[chain], msg.snapshot)
      // Keep the last loaded view as baseline (a restarted server first sends an empty snapshot).
      if (hasData(msg.snapshot)) latest.current[chain] = msg.snapshot
      set((s) => ({ snapshots: { ...s.snapshots, [chain]: msg.snapshot } }))
      events.forEach(notify)
    }

    ;(async () => {
      for (let delay = 2_000; !ac.signal.aborted; delay = Math.min(delay * 2, 60_000)) {
        try {
          const url = `${location.origin}/api/stream`
          let auth
          try {
            const nostr = await waitForNostr()
            auth = await nip98.getToken(url, "GET", (e) => nostr.signEvent(e), true)
          } catch {
            throw new Fatal("Couldn't sign the login request. Unlock your Nostr extension and retry.")
          }
          const res = await fetch(url, { headers: { Authorization: auth }, signal: ac.signal })
          if (res.status === 403) throw new Fatal("This Nostr account is not authorized to view this wallet.")
          if (res.status === 401) throw new Fatal("Nostr authentication failed. Check your system clock and retry.")
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

          set({ live: true, error: undefined })
          delay = 2_000
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          let buf = ""
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += value
            let end
            while ((end = buf.indexOf("\n\n")) >= 0) {
              const data = buf
                .slice(0, end)
                .split("\n")
                .filter((l) => l.startsWith("data: "))
                .map((l) => l.slice(6))
                .join("\n")
              buf = buf.slice(end + 2)
              if (data) onMessage(JSON.parse(data))
            }
          }
        } catch (e) {
          if (ac.signal.aborted) return
          if (e instanceof Fatal) return set({ live: false, error: e.message })
        }
        set({ live: false })
        await sleep(delay)
      }
    })()

    return () => ac.abort()
  }, [pubkey, attempt, router])

  const value = state.owner === pubkey ? state : EMPTY
  const chains = enabledChains(value.settings)
  // a disabled extension's chain disappears everywhere at once, even before the server drops it
  const snapshots = Object.fromEntries(Object.entries(value.snapshots).filter(([c]) => chains.includes(c as Chain)))
  return (
    <Ctx.Provider value={{ ...value, snapshots, chains, retry: () => (setState(EMPTY), setAttempt((a) => a + 1)) }}>{children}</Ctx.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider")
  return ctx
}
