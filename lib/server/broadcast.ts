import "server-only"
import type { ChainClient } from "@/lib/server/watcher"

export class BroadcastError extends Error {}

/** Push a raw tx to the watcher's own chain: its mempool sources in order, then Electrum. Returns the txid. */
export async function broadcastHex(watcher: ChainClient, hex: string) {
  for (const base of watcher.mempool) {
    try {
      const res = await fetch(`${base}/api/tx`, {
        method: "POST",
        body: hex,
        headers: { "Content-Type": "text/plain" },
        signal: AbortSignal.timeout(20_000),
      })
      const text = (await res.text()).trim()
      if (res.ok) return text
      if (res.status >= 400 && res.status < 500) throw new BroadcastError(text || "Rejected by the network")
    } catch (e) {
      if (e instanceof BroadcastError) throw e
    }
  }
  try {
    return await watcher.client.request<string>("blockchain.transaction.broadcast", [hex])
  } catch (e) {
    throw new BroadcastError((e as Error).message || "Broadcast failed")
  }
}
