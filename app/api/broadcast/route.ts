import { authorizedJson, isChain } from "@/lib/server/auth"
import { broadcastHex } from "@/lib/server/broadcast"
import { CHAINS } from "@/lib/chains"
import { ChainInactiveError, chainFor, parseTx } from "@/lib/server/watcher"
import { SIGHASH_UNIFIED } from "@/lib/unified-sighash"

/**
 * POST {chain, hex} → {txid}. Sent only to that chain's own mempool sources (Electrum fallback). On a SIGHASH_UNIFIED
 * chain (Blake) every signature must use it, so the tx can't be replayed elsewhere; on others none may.
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
    const { label, unifiedSighash } = CHAINS[body.chain]
    if (unifiedSighash && !unified) return Response.json({ error: `${label} transactions must be SIGHASH_UNIFIED-signed (replay protection)` }, { status: 422 })
    if (!unifiedSighash && unified) return Response.json({ error: `This transaction is SIGHASH_UNIFIED-signed: ${label} rejects it` }, { status: 422 })
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
