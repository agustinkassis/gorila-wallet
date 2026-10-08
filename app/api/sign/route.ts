import { base64 } from "@scure/base"
import { authorizedJson, isChain } from "@/lib/server/auth"
import { SignError, signPsbt } from "@/lib/server/signer"
import { ExtensionDisabledError } from "@/lib/server/watcher"
import { PlanError } from "@/lib/tx"

/** POST {chain, psbt (base64)} → {hex, txid, fee, vsize}. Bitcoin: SIGHASH_ALL. Blake: SIGHASH_UNIFIED. */
export async function POST(req: Request) {
  const body = await authorizedJson<{ chain?: unknown; psbt?: unknown }>(req)
  if (body instanceof Response) return body
  if (!isChain(body.chain) || typeof body.psbt !== "string") return Response.json({ error: "Invalid request" }, { status: 400 })
  try {
    return Response.json(await signPsbt(body.chain, base64.decode(body.psbt)))
  } catch (e) {
    if (e instanceof ExtensionDisabledError) return Response.json({ error: e.message }, { status: 409 })
    if (e instanceof SignError || e instanceof PlanError) return Response.json({ error: e.message }, { status: 422 })
    return Response.json({ error: "Signing failed" }, { status: 500 })
  }
}
