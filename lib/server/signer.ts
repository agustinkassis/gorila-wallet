import "server-only"
import { db } from "@/lib/server/db"
import { signWith } from "@/lib/server/sign-core"
import { chainFor } from "@/lib/server/watcher"
import { signingAccount } from "@/lib/server/wallets"
import type { Chain } from "@/lib/wallet"

export { SignError } from "@/lib/server/sign-core"

/**
 * Sign with a wallet's keys (env seed, or a software seed unlocked by its password for this call only).
 * Prevouts come from the chain (SQLite raw-tx cache / Electrum), frozen coins from the wallet's labels.
 */
export async function signPsbt(walletId: string, chain: Chain, psbt: Uint8Array, password?: unknown) {
  const [acct, client] = await Promise.all([signingAccount(walletId, password), chainFor(chain)])
  const frozen = await db.label.findMany({ where: { walletId, chain, type: "output", spendable: false }, select: { ref: true } })
  return signWith(chain, psbt, {
    ...acct,
    prevOut: async (txid, vout) => (await client.getTx(txid)).getOutput(vout),
    frozen: new Set(frozen.map((l) => l.ref)),
  })
}
