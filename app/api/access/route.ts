import { nip19 } from "nostr-tools"
import { authorizedJson, envPubkeys, requireNostr, toHexPubkey } from "@/lib/server/auth"
import { db } from "@/lib/server/db"

const list = async () => ({
  env: [...envPubkeys()].map((h) => nip19.npubEncode(h)),
  accounts: (await db.account.findMany({ orderBy: { createdAt: "asc" } })).map((a) => nip19.npubEncode(a.pubkey)),
})

/** GET → Nostr keys allowed to log in: from ALLOWED_PUBKEYS (read-only) and from Settings. */
export async function GET(req: Request) {
  return (await requireNostr(req)) ?? Response.json(await list())
}

/** POST {action: add|remove, pubkey (npub or hex)}. Refuses to remove the last key that can log in. */
export async function POST(req: Request) {
  const body = await authorizedJson<{ action?: unknown; pubkey?: unknown }>(req)
  if (body instanceof Response) return body
  let pubkey: string
  try {
    pubkey = toHexPubkey(String(body.pubkey ?? ""))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
  if (body.action === "add") await db.account.upsert({ where: { pubkey }, create: { pubkey }, update: {} })
  else if (body.action === "remove") {
    const removed = await db.$transaction(async (tx) => {
      if (!envPubkeys().size && (await tx.account.count()) <= 1) return false
      await tx.account.deleteMany({ where: { pubkey } })
      return true
    })
    if (!removed) return Response.json({ error: "Can't remove the last key that can log in" }, { status: 422 })
  } else return Response.json({ error: "Unknown action" }, { status: 400 })
  return Response.json(await list())
}
