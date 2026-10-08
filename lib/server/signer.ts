import "server-only"
import { db } from "@/lib/server/db"
import { getAccount, privateKeyFor } from "@/lib/server/keys"
import { signWith } from "@/lib/server/sign-core"
import { watcherFor } from "@/lib/server/watcher"
import type { Chain } from "@/lib/wallet"

export { SignError } from "@/lib/server/sign-core"

/** Sign with the wallet seed; prevouts come from the chain (SQLite raw-tx cache / Electrum), frozen coins from labels. */
export async function signPsbt(chain: Chain, psbt: Uint8Array) {
  const { fingerprint, path } = getAccount()
  const watcher = await watcherFor(chain)
  const frozen = await db.label.findMany({ where: { chain, type: "output", spendable: false }, select: { ref: true } })
  return signWith(chain, psbt, {
    fingerprint,
    accountPath: path,
    keyFor: privateKeyFor,
    prevOut: async (txid, vout) => (await watcher.getTx(txid)).getOutput(vout),
    frozen: new Set(frozen.map((l) => l.ref)),
  })
}
