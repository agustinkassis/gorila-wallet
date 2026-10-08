import { authorizedJson, isChain } from "@/lib/server/auth"
import { broadcastHex } from "@/lib/server/broadcast"
import { ExtensionDisabledError, chainFor, parseTx } from "@/lib/server/watcher"
import { SIGHASH_UNIFIED } from "@/lib/unified-sighash"

/**
 * POST {chain, hex} → {txid}. Sent only to that chain's own mempool instance (Electrum fallback),
 * and a Blake tx must be fully SIGHASH_UNIFIED-signed so it can't be replayed onto Bitcoin.
 */
export async function POST(req: Request) {
  const body = await authorizedJson<{ chain?: unknown; hex?: unknown }>(req)
  if (body instanceof Response) return body
  if (!isChain(body.chain) || typeof body.hex !== "string" || !/^[0-9a-f]+$/i.test(body.hex))
    return Response.json({ error: "Invalid request" }, { status: 400 })

  let tx
  try {
    tx = parseTx(body.hex)
  } catch {
    return Response.json({ error: "Invalid transaction" }, { status: 400 })
  }
  for (let i = 0; i < tx.inputsLength; i++) {
    const sig = tx.getInput(i).finalScriptWitness?.[0]
    const unified = !!sig && (sig[sig.length - 1] & SIGHASH_UNIFIED) !== 0
    if (body.chain === "xbt" && !unified) return Response.json({ error: "Blake transactions must be SIGHASH_UNIFIED-signed (replay protection)" }, { status: 422 })
    if (body.chain === "btc" && unified) return Response.json({ error: "This is a Blake-signed transaction" }, { status: 422 })
  }

  let watcher
  try {
    watcher = await chainFor(body.chain)
  } catch (e) {
    if (e instanceof ExtensionDisabledError) return Response.json({ error: e.message }, { status: 409 })
    throw e
  }
  try {
    return Response.json({ txid: await broadcastHex(watcher, body.hex) })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 })
  }
}
