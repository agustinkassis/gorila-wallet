import { authorizedJson, isChain } from "@/lib/server/auth"
import { broadcastHex, validateBroadcast, BroadcastError } from "@/lib/server/broadcast"
import { ChainInactiveError, chainFor } from "@/lib/server/watcher"

/**
 * POST {chain, hex} → {txid}. Sent only to that chain's own mempool sources (Electrum fallback). On a SIGHASH_UNIFIED
 * chain (Blake) every signature must use it, so the tx can't be replayed elsewhere; on others none may.
 */
export async function POST(req: Request) {
  const body = await authorizedJson<{ chain?: unknown; hex?: unknown }>(req)
  if (body instanceof Response) return body
  if (!isChain(body.chain) || typeof body.hex !== "string" || !/^[0-9a-f]+$/i.test(body.hex))
    return Response.json({ error: "Invalid request" }, { status: 400 })

  try {
    validateBroadcast(body.chain, body.hex)
  } catch (e) {
    if (!(e instanceof BroadcastError) || e.message === "Invalid transaction") return Response.json({ error: "Invalid transaction" }, { status: 400 })
    return Response.json({ error: e.message }, { status: 422 })
  }

  let watcher
  try {
    watcher = await chainFor(body.chain)
  } catch (e) {
    if (e instanceof ChainInactiveError) return Response.json({ error: e.message }, { status: 409 })
    throw e
  }
  try {
    return Response.json({ txid: await broadcastHex(watcher, body.hex) })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 })
  }
}
