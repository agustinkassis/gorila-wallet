import "server-only"
import { nip19, nip98 } from "nostr-tools"
import { config } from "@/lib/server/config"
import { db } from "@/lib/server/db"

export const toHexPubkey = (key: string) => {
  const k = key.trim()
  const hex = k.startsWith("npub") ? (nip19.decode(k).data as string) : k.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("Invalid Nostr public key")
  return hex
}

export const envPubkeys = () => new Set(config.allowedPubkeys.map(toHexPubkey))

/**
 * Allowed: ALLOWED_PUBKEYS plus accounts stored in the DB (managed in Settings).
 * With neither, the first valid login claims the app (trust on first use). The claim is a unique
 * insert, so two simultaneous first logins can't both become owner.
 */
async function isAllowed(pubkey: string) {
  if (envPubkeys().has(pubkey)) return true
  if (await db.account.findUnique({ where: { pubkey } })) return true
  if (envPubkeys().size || (await db.account.count())) return false
  try {
    await db.setting.create({ data: { key: "owner", value: JSON.stringify(pubkey) } })
  } catch {
    return false // someone else claimed it first
  }
  await db.account.create({ data: { pubkey } })
  return true
}

/**
 * NIP-98 + allowlist. Returns an error Response, or null when the request is authorized.
 * With `body`, the event's `payload` tag must match its hash (a captured token can't carry another body).
 */
// ponytail: `u` tag is matched against req.url; behind a reverse proxy, compare against an APP_URL env instead.
export async function requireNostr(req: Request, body?: object): Promise<Response | null> {
  const header = req.headers.get("authorization")
  if (!header?.startsWith("Nostr ")) return Response.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const event = await nip98.unpackEventFromToken(header)
    await nip98.validateEvent(event, req.url, req.method, body)
    if (body && !event.tags.some(([t]) => t === "payload")) throw new Error("payload tag required")
    if (!(await isAllowed(event.pubkey))) return Response.json({ error: "Forbidden" }, { status: 403 })
    return null
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
}

/** Parse a JSON POST body and authorize it (payload-bound). Returns the body, or an error Response. */
export async function authorizedJson<T extends object>(req: Request): Promise<T | Response> {
  let body: T
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 })
  return (await requireNostr(req, body)) ?? body
}

export { isChain } from "@/lib/chains"
