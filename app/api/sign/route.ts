import { base64 } from "@scure/base"
import { authorizedJson, isChain } from "@/lib/server/auth"
import { SignError, signPsbt } from "@/lib/server/signer"
import { WrongPasswordError } from "@/lib/server/secret"
import { ExtensionDisabledError } from "@/lib/server/watcher"
import { WalletError } from "@/lib/server/wallets"
import { PlanError } from "@/lib/tx"

/**
 * POST {walletId, chain, psbt (base64), password?} → {hex, txid, fee, vsize}. Bitcoin: SIGHASH_ALL. Blake: SIGHASH_UNIFIED.
 * Software wallets need their password; watch-only wallets can't sign.
 */
export async function POST(req: Request) {
  const body = await authorizedJson<{ walletId?: unknown; chain?: unknown; psbt?: unknown; password?: unknown }>(req)
  if (body instanceof Response) return body
  if (typeof body.walletId !== "string" || !isChain(body.chain) || typeof body.psbt !== "string") return Response.json({ error: "Invalid request" }, { status: 400 })
  try {
    return Response.json(await signPsbt(body.walletId, body.chain, base64.decode(body.psbt), body.password))
  } catch (e) {
    if (e instanceof ExtensionDisabledError) return Response.json({ error: e.message }, { status: 409 })
    if (e instanceof SignError || e instanceof PlanError || e instanceof WalletError || e instanceof WrongPasswordError) return Response.json({ error: e.message }, { status: 422 })
    return Response.json({ error: "Signing failed" }, { status: 500 })
  }
}
