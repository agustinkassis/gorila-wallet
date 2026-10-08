"use client"

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react"
import { SimplePool, type Event, type EventTemplate } from "nostr-tools"
import { toast } from "sonner"
import { requestNotifications } from "@/lib/notify"

declare global {
  interface Window {
    nostr?: { getPublicKey(): Promise<string>; signEvent(e: EventTemplate): Promise<Event> }
  }
}

export type Profile = { name?: string; display_name?: string; picture?: string }

const STORAGE_KEY = "gorilla-wallet:pubkey"
const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]

// localStorage as an external store: no hydration mismatch, and logout in one tab logs out the others.
const subscribe = (cb: () => void) => (window.addEventListener("storage", cb), () => window.removeEventListener("storage", cb))
const readPubkey = () => localStorage.getItem(STORAGE_KEY)
function writePubkey(pubkey: string | null) {
  if (pubkey) localStorage.setItem(STORAGE_KEY, pubkey)
  else localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new StorageEvent("storage"))
}

/** NIP-07 extensions inject window.nostr shortly after load. */
export async function waitForNostr(timeoutMs = 3000) {
  for (let t = 0; !window.nostr && t < timeoutMs; t += 100) await new Promise((r) => setTimeout(r, 100))
  if (!window.nostr) throw new Error("No NIP-07 extension found")
  return window.nostr
}

type NostrContext = {
  /** undefined while hydrating, null when logged out */
  pubkey: string | null | undefined
  profile: Profile | null
  login: () => Promise<void>
  logout: () => void
}

const Ctx = createContext<NostrContext | null>(null)

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const pubkey = useSyncExternalStore(subscribe, readPubkey, () => undefined)
  const [profile, setProfile] = useState<{ pubkey: string; data: Profile } | null>(null)

  useEffect(() => {
    if (!pubkey) return
    const pool = new SimplePool()
    pool
      .get(RELAYS, { kinds: [0], authors: [pubkey] })
      .then((e) => e && setProfile({ pubkey, data: JSON.parse(e.content) }))
      .catch(() => {})
    return () => pool.close(RELAYS)
  }, [pubkey])

  const login = useCallback(async () => {
    try {
      const nostr = await waitForNostr(500)
      writePubkey(await nostr.getPublicKey())
      requestNotifications()
    } catch {
      toast.error("No Nostr extension found", { description: "Install a NIP-07 extension like Alby or nos2x, then try again." })
    }
  }, [])

  const logout = useCallback(() => writePubkey(null), [])

  return (
    <Ctx.Provider value={{ pubkey, profile: profile && profile.pubkey === pubkey ? profile.data : null, login, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNostr() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useNostr must be used inside NostrProvider")
  return ctx
}
