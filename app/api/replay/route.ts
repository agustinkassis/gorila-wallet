import { authorizedJson, isChain } from "@/lib/server/auth"
import { analyzeReplay } from "@/lib/server/replay"
import { ExtensionDisabledError } from "@/lib/server/watcher"

/** POST {walletId, chain, txid} → replay analysis of that tx onto the other chain (needs the Blake2b extension). */
export async function POST(req: Request) {
  const body = await authorizedJson<{ walletId?: unknown; chain?: unknown; txid?: unknown }>(req)
  if (body instanceof Response) return body
  if (typeof body.walletId !== "string" || !isChain(body.chain) || typeof body.txid !== "string" || !/^[0-9a-f]{64}$/.test(body.txid))
    return Response.json({ error: "Invalid request" }, { status: 400 })
  try {
    return Response.json(await analyzeReplay(body.walletId, body.chain, body.txid))
  } catch (e) {
    if (e instanceof ExtensionDisabledError) return Response.json({ error: e.message }, { status: 409 })
    return Response.json({ error: "Transaction not found" }, { status: 404 })
  }
}
