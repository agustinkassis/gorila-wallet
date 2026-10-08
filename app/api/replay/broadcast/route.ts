import { authorizedJson, isChain } from "@/lib/server/auth"
import { broadcastHex } from "@/lib/server/broadcast"
import { analyzeReplay } from "@/lib/server/replay"
import { ExtensionDisabledError, chainFor } from "@/lib/server/watcher"

/**
 * POST {walletId, chain, txid} → {txid}. Re-analyzes on the server and broadcasts the source chain's own bytes
 * to the other chain only when every check passes. The client never supplies the transaction.
 */
export async function POST(req: Request) {
  const body = await authorizedJson<{ walletId?: unknown; chain?: unknown; txid?: unknown }>(req)
  if (body instanceof Response) return body
  if (typeof body.walletId !== "string" || !isChain(body.chain) || typeof body.txid !== "string" || !/^[0-9a-f]{64}$/.test(body.txid))
    return Response.json({ error: "Invalid request" }, { status: 400 })
  try {
    const analysis = await analyzeReplay(body.walletId, body.chain, body.txid)
    if (!analysis.replayable) {
      const reason = analysis.checks.find((c) => c.status === "fail")
      return Response.json({ error: reason ? `${reason.label}: ${reason.detail}` : "Not replayable" }, { status: 422 })
    }
    const txid = await broadcastHex(await chainFor(analysis.to), analysis.hex)
    return Response.json({ txid, to: analysis.to })
  } catch (e) {
    if (e instanceof ExtensionDisabledError) return Response.json({ error: e.message }, { status: 409 })
    return Response.json({ error: (e as Error).message || "Replay failed" }, { status: 422 })
  }
}
