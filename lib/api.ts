"use client"

import { nip98 } from "nostr-tools"
import { waitForNostr } from "@/components/nostr-provider"

/**
 * NIP-98 authenticated call to our backend. POST bodies are bound to the signature via the `payload` tag.
 * Throws an Error with the server's message on failure.
 */
export async function api<T = unknown>(path: string, body?: object): Promise<T> {
  const url = `${location.origin}${path}`
  const method = body ? "POST" : "GET"
  const nostr = await waitForNostr()
  const auth = await nip98.getToken(url, method, (e) => nostr.signEvent({ ...e, tags: [...e.tags, ["nonce", crypto.randomUUID()]] }), true, body)
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
  return (res.headers.get("content-type")?.includes("json") ? res.json() : res.text()) as Promise<T>
}

/** Save bytes/text as a file in the browser. */
export function download(name: string, data: BlobPart, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement("a"), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
