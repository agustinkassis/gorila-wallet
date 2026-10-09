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

/** Long-lived streams must stop delivering data after access is revoked. */
export function watchAccess(pubkey: string, onDenied: () => void) {
  const timer = setInterval(() => {
    void db.account.findUnique({ where: { pubkey } })
      .then((account) => { if (!envPubkeys().has(pubkey) && !account) onDenied() })
      .catch(onDenied)
  }, 25_000)
  return () => clearInterval(timer)
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
    if (body !== undefined && !nip98.validateEventPayloadTag(event, body)) throw new Error("payload hash required")
    if (!(await isAllowed(event.pubkey))) return Response.json({ error: "Forbidden" }, { status: 403 })
    // Persist the event ID: concurrent requests, restarts and multiple workers must not replay a write.
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (body === undefined) throw new Error("Write requests require a payload")
      // NIP-98 validation above rejects timestamps outside the 60-second window.
      // expiresAt only cleans up used IDs; their unique constraint blocks replay within that window.
      await db.authEvent.deleteMany({ where: { expiresAt: { lte: Math.round(Date.now() / 1000) } } })
      await db.authEvent.create({ data: { id: event.id, expiresAt: event.created_at + 60 } })
    }
    return null
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
}

/** Parse a JSON POST body and authorize it (payload-bound). Returns the body, or an error Response. */
export async function authorizedJson<T extends object>(req: Request): Promise<T | Response> {
  if (!req.headers.get("authorization")?.startsWith("Nostr ")) return Response.json({ error: "Unauthorized" }, { status: 401 })
  // Enforce the limit while reading, including chunked requests without Content-Length.
  const maxBytes = 6 * 1024 * 1024 // includes the existing 5 MB labels import
  if (Number(req.headers.get("content-length")) > maxBytes) return Response.json({ error: "Body too large" }, { status: 413 })
  const reader = req.body?.getReader()
  if (!reader) return Response.json({ error: "Invalid JSON" }, { status: 400 })
  let body: T
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        return Response.json({ error: "Body too large" }, { status: 413 })
      }
      chunks.push(value)
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid body" }, { status: 400 })
  return (await requireNostr(req, body)) ?? body
}

export { isChain } from "@/lib/chains"
