import { authorizedJson, isChain } from "@/lib/server/auth"
import { republish, setLabel } from "@/lib/server/labels"

/** POST {chain, jsonl} — import BIP-329 records (tx, addr, output; other types are skipped). */
export async function POST(req: Request) {
  const body = await authorizedJson<{ chain?: unknown; jsonl?: unknown }>(req)
  if (body instanceof Response) return body
  if (!isChain(body.chain) || typeof body.jsonl !== "string" || body.jsonl.length > 5_000_000)
    return Response.json({ error: "Invalid request" }, { status: 400 })
  let imported = 0
  let skipped = 0
  for (const line of body.jsonl.split("\n")) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      const type = r.type
      const ref = String(r.ref ?? "")
      const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 255) : null
      const spendable = type === "output" && typeof r.spendable === "boolean" ? r.spendable : null
      const ok =
        (type === "tx" && /^[0-9a-f]{64}$/.test(ref)) ||
        (type === "output" && /^[0-9a-f]{64}:\d{1,6}$/.test(ref)) ||
        (type === "addr" && /^(bc1|[13])[0-9A-Za-z]{20,87}$/.test(ref))
      if (!ok || (label === null && spendable === null)) {
        skipped++
        continue
      }
      await setLabel(type === "addr" ? "all" : body.chain, type, ref, label, spendable)
      imported++
    } catch {
      skipped++
    }
  }
  await republish()
  return Response.json({ imported, skipped })
}
