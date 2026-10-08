import "server-only"
import { db } from "@/lib/server/db"
import { currentSyncs } from "@/lib/server/watcher"

export type LabelType = "tx" | "addr" | "output"

/** Upsert a BIP-329-style label for a wallet; clearing both label and spendable removes the row. */
export async function setLabel(walletId: string, chain: string, type: LabelType, ref: string, label: string | null, spendable: boolean | null) {
  if (label === null && spendable === null) await db.label.deleteMany({ where: { walletId, chain, type, ref } })
  else
    await db.label.upsert({
      where: { walletId_chain_type_ref: { walletId, chain, type, ref } },
      create: { walletId, chain, type, ref, label, spendable },
      update: { label, spendable },
    })
}

/** Labels/frozen flags are joined into snapshots: rebuild that wallet's. */
export const republish = (walletId: string) => Promise.all(currentSyncs().filter((s) => s.walletId === walletId).map((s) => s.publish()))
