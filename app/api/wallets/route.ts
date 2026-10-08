import { authorizedJson } from "@/lib/server/auth"
import { syncWatchers } from "@/lib/server/watcher"
import { WalletError, createSeedWallet, deleteWallet, importWatchWallet, renameWallet } from "@/lib/server/wallets"

/**
 * POST {action, ...}
 *   seed   {name, mnemonic, passphrase?, path?, password} → new software wallet (created or imported words)
 *   watch  {name, xpub, path?, fingerprint?}             → watch-only wallet
 *   rename {id, name} · delete {id}
 * Recovery words arrive in a NIP-98 payload-bound request and are stored only sealed with the wallet password.
 */
export async function POST(req: Request) {
  const body = await authorizedJson<Record<string, unknown>>(req)
  if (body instanceof Response) return body
  try {
    let result: unknown = { ok: true }
    if (body.action === "seed")
      result = await createSeedWallet({ name: body.name, mnemonic: body.mnemonic, passphrase: body.passphrase, path: body.path, password: body.password })
    else if (body.action === "watch") result = await importWatchWallet({ name: body.name, xpub: body.xpub, path: body.path, fingerprint: body.fingerprint })
    else if (body.action === "rename") await renameWallet(body.id, body.name)
    else if (body.action === "delete") await deleteWallet(body.id)
    else return Response.json({ error: "Unknown action" }, { status: 400 })
    await syncWatchers() // start/stop this wallet's sync on every chain
    return Response.json(result)
  } catch (e) {
    if (e instanceof WalletError) return Response.json({ error: e.message }, { status: 422 })
    return Response.json({ error: "Wallet operation failed" }, { status: 500 })
  }
}
