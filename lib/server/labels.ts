import "server-only"
import { db } from "@/lib/server/db"
import { currentWatchers } from "@/lib/server/watcher"

export type LabelType = "tx" | "addr" | "output"

/** Upsert a BIP-329-style label; clearing both label and spendable removes the row. */
export async function setLabel(chain: string, type: LabelType, ref: string, label: string | null, spendable: boolean | null) {
  if (label === null && spendable === null) await db.label.deleteMany({ where: { chain, type, ref } })
  else await db.label.upsert({ where: { chain_type_ref: { chain, type, ref } }, create: { chain, type, ref, label, spendable }, update: { label, spendable } })
}

/** Labels/frozen flags are joined into snapshots: rebuild them. */
export const republish = () => Promise.all(Object.values(currentWatchers()).map((w) => w!.publish()))
