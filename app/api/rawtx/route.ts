import { authorizedJson, isChain } from "@/lib/server/auth"
import { ChainInactiveError, chainFor } from "@/lib/server/watcher"

/** POST {chain, txids} → {[txid]: hex}. Parent txs for PSBT nonWitnessUtxo and fee bumping (SQLite cache first). */
export async function POST(req: Request) {
  const body = await authorizedJson<{ chain?: unknown; txids?: unknown }>(req)
  if (body instanceof Response) return body
  const txids = body.txids
  if (!isChain(body.chain) || !Array.isArray(txids) || txids.length > 200 || !txids.every((t) => typeof t === "string" && /^[0-9a-f]{64}$/.test(t)))
    return Response.json({ error: "Invalid request" }, { status: 400 })
  try {
    const watcher = await chainFor(body.chain)
    const entries = await Promise.all(txids.map(async (t: string) => [t, await watcher.rawHex(t)] as const))
    return Response.json(Object.fromEntries(entries))
  } catch (e) {
    if (e instanceof ChainInactiveError) return Response.json({ error: e.message }, { status: 409 })
    return Response.json({ error: "Transaction not found" }, { status: 404 })
  }
}
