import "server-only"
import { nip19, nip98 } from "nostr-tools"
import { config } from "@/lib/server/config"

const toHexPubkey = (key: string) => {
  const k = key.trim()
  const hex = k.startsWith("npub") ? (nip19.decode(k).data as string) : k.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`Invalid Nostr public key in ALLOWED_PUBKEYS: ${k}`)
  return hex
}

/** ALLOWED_PUBKEYS as hex. Empty: no login, and the app only answers on localhost. */
export const allowedPubkeys = () => new Set(config.allowedPubkeys.map(toHexPubkey))

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Without ALLOWED_PUBKEYS: only requests addressed to localhost from this app's own pages. The Host check stops DNS
 * rebinding, the Origin check stops other sites (and other local apps) posting to the API. The port is only bound on
 * 127.0.0.1 (package.json), so the LAN can't reach it at all.
 * With it: NIP-98 + allowlist. With `body`, the event's `payload` tag must match its hash (a captured token can't carry
 * another body). Returns an error Response, or null when the request is authorized.
 */
// ponytail: `u` tag is matched against req.url; behind a reverse proxy, compare against an APP_URL env instead.
export async function requireNostr(req: Request, body?: object): Promise<Response | null> {
  const allowed = allowedPubkeys()
  if (!allowed.size) {
    const host = req.headers.get("host") ?? ""
    const origin = req.headers.get("origin")
    if (LOCAL_HOST.test(host) && (!origin || URL.parse(origin)?.host === host)) return null
    return Response.json({ error: "Without ALLOWED_PUBKEYS, Gorilla Wallet only opens from localhost." }, { status: 403 })
  }
  const header = req.headers.get("authorization")
  if (!header?.startsWith("Nostr ")) return Response.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const event = await nip98.unpackEventFromToken(header)
    await nip98.validateEvent(event, req.url, req.method, body)
    if (body && !event.tags.some(([t]) => t === "payload")) throw new Error("payload tag required")
    if (!allowed.has(event.pubkey)) return Response.json({ error: "Forbidden" }, { status: 403 })
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
