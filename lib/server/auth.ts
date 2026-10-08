import "server-only"
import { nip19, nip98 } from "nostr-tools"

const toHex = (key: string) => (key.startsWith("npub") ? (nip19.decode(key).data as string) : key.toLowerCase())

function allowedPubkeys() {
  return new Set((process.env.ALLOWED_PUBKEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean).map(toHex))
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
    if (!allowedPubkeys().has(event.pubkey)) return Response.json({ error: "Forbidden" }, { status: 403 })
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

export const isChain = (c: unknown): c is "btc" | "xbt" => c === "btc" || c === "xbt"
