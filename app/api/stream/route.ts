import { requireNostr } from "@/lib/server/auth"
import { getAccount } from "@/lib/server/keys"
import { getSettings, onSettings } from "@/lib/server/settings"
import { currentWatchers, onWatchersChange, syncWatchers } from "@/lib/server/watcher"
import type { Chain, StreamMessage } from "@/lib/wallet"

/**
 * SSE: `init` (xpub, path, fingerprint), settings, then live per-chain snapshots. One NIP-98 signature per connection.
 * Chains follow the active watchers: toggling the Blake2b extension adds/drops XBT on open streams.
 */
export async function GET(req: Request) {
  const denied = await requireNostr(req)
  if (denied) return denied

  let account, settings
  try {
    account = getAccount()
    await syncWatchers()
    settings = await getSettings()
  } catch {
    return Response.json({ error: "Wallet is not configured" }, { status: 500 })
  }

  const enc = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          cleanup()
        }
      }
      const send = (msg: StreamMessage) => write(`data: ${JSON.stringify(msg)}\n\n`)

      send({ type: "init", xpub: account.xpub, path: account.path, fingerprint: account.fingerprint })
      send({ type: "settings", settings })
      const chains = new Map<Chain, () => void>()
      const attach = () => {
        const active = currentWatchers()
        for (const [chain, unsub] of chains)
          if (!active[chain]) {
            unsub()
            chains.delete(chain)
          }
        for (const w of Object.values(active))
          if (w && !chains.has(w.chain)) {
            send({ type: "snapshot", snapshot: w.snapshot })
            chains.set(w.chain, w.subscribe((snapshot) => send({ type: "snapshot", snapshot })))
          }
      }
      attach()
      const offWatchers = onWatchersChange(attach)
      const offSettings = onSettings((s) => send({ type: "settings", settings: s }))
      const ping = setInterval(() => write(": ping\n\n"), 25_000)
      cleanup = () => {
        clearInterval(ping)
        offWatchers()
        offSettings()
        chains.forEach((u) => u())
        chains.clear()
      }
      req.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
