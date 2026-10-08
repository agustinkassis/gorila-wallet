import { authorizedJson, isChain, requireNostr } from "@/lib/server/auth"
import { db } from "@/lib/server/db"
import { republish, setLabel, type LabelType } from "@/lib/server/labels"
import { getWallet } from "@/lib/server/wallets"

const TYPES: LabelType[] = ["tx", "addr", "output"]
const REF: Record<LabelType, RegExp> = {
  tx: /^[0-9a-f]{64}$/,
  output: /^[0-9a-f]{64}:\d{1,6}$/,
  addr: /^bc1[0-9a-z]{8,87}$|^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/,
}

/**
 * POST {walletId, chain: btc|xbt|all, type, ref, label?, spendable?} — set a label and/or freeze flag (spendable=false).
 * Address labels use chain "all" (an address is the same on both chains); tx/output labels are per chain.
 */
export async function POST(req: Request) {
  const body = await authorizedJson<{ walletId?: unknown; chain?: unknown; type?: unknown; ref?: unknown; label?: unknown; spendable?: unknown }>(req)
  if (body instanceof Response) return body
  const wallet = await getWallet(body.walletId).catch(() => null)
  if (!wallet) return Response.json({ error: "Unknown wallet" }, { status: 400 })
  const walletId = wallet.id
  const { chain, type, ref } = body
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 255) : null
  const spendable = typeof body.spendable === "boolean" ? body.spendable : null
  if (!(isChain(chain) || chain === "all") || !TYPES.includes(type as LabelType) || typeof ref !== "string" || !REF[type as LabelType].test(ref))
    return Response.json({ error: "Invalid label" }, { status: 400 })
  if (type === "addr" ? chain !== "all" : chain === "all") return Response.json({ error: "Invalid label scope" }, { status: 400 })
  // keep the existing value of whichever field wasn't sent
  const current = await db.label.findUnique({ where: { walletId_chain_type_ref: { walletId, chain, type: type as string, ref } } })
  await setLabel(walletId, chain, type as LabelType, ref, "label" in body ? label : (current?.label ?? null), "spendable" in body ? spendable : (current?.spendable ?? null))
  await republish(walletId)
  return Response.json({ ok: true })
}

/** GET ?wallet=…&chain=btc|xbt → BIP-329 JSON Lines export of a wallet on a chain (address labels included). */
export async function GET(req: Request) {
  const denied = await requireNostr(req)
  if (denied) return denied
  const params = new URL(req.url).searchParams
  const chain = params.get("chain")
  const wallet = await getWallet(params.get("wallet")).catch(() => null)
  if (!isChain(chain) || !wallet) return Response.json({ error: "Invalid wallet or chain" }, { status: 400 })
  const rows = await db.label.findMany({ where: { walletId: wallet.id, chain: { in: [chain, "all"] } }, orderBy: [{ type: "asc" }, { ref: "asc" }] })
  const lines = rows.map((r) =>
    JSON.stringify({
      type: r.type,
      ref: r.ref,
      ...(r.label ? { label: r.label } : {}),
      ...(r.type === "output" && r.spendable !== null ? { spendable: r.spendable } : {}),
    }),
  )
  return new Response(lines.join("\n") + (lines.length ? "\n" : ""), {
    headers: { "Content-Type": "application/jsonl", "Content-Disposition": `attachment; filename="gorilla-wallet-${chain}-labels.jsonl"` },
  })
}
