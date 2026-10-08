import "server-only"
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"

// The only place that touches SEED_PHRASE. Never log or return anything but public data.
let cache: { account: HDKey; xpub: string; path: string; fingerprint: number } | undefined

function load() {
  if (cache) return cache
  const mnemonic = process.env.SEED_PHRASE?.trim().toLowerCase().split(/\s+/).join(" ")
  const path = process.env.DERIVATION_PATH?.trim()
  if (!mnemonic || !path || !validateMnemonic(mnemonic, wordlist)) throw new Error("Wallet is not configured")
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic))
  const account = master.derive(path)
  cache = { account, xpub: account.publicExtendedKey, path, fingerprint: master.fingerprint }
  return cache
}

/** Public account data: xpub, derivation path, master key fingerprint (for PSBT bip32Derivation). */
export function getAccount() {
  const { xpub, path, fingerprint } = load()
  return { xpub, path, fingerprint }
}

/** Private key for account/change/index. Signer use only. */
export function privateKeyFor(change: number, index: number) {
  const key = load().account.deriveChild(change).deriveChild(index)
  return { privateKey: key.privateKey!, publicKey: key.publicKey! }
}
