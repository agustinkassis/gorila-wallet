import "server-only"
import { randomUUID } from "node:crypto"
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { config } from "@/lib/server/config"
import { db } from "@/lib/server/db"
import { seal, unseal } from "@/lib/server/secret"
import { DERIVATION_PATH, normalizeXpub, type WalletInfo, type WalletKind } from "@/lib/wallet"

export const ENV_WALLET_ID = "env"

export class WalletError extends Error {}
export class WatchOnlyError extends WalletError {
  constructor() {
    super("This is a watch-only wallet: it has no keys to sign with")
  }
}

const normalizeMnemonic = (m: string) => m.trim().toLowerCase().split(/\s+/).join(" ")

function account(mnemonic: string, passphrase: string, path: string) {
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase))
  return { account: master.derive(path), fingerprint: master.fingerprint }
}

// The .env seed (optional). Derived once; never written to the database.
let envCache: { account: HDKey; fingerprint: number; path: string } | null | undefined
function envAccount() {
  if (envCache !== undefined) return envCache
  const mnemonic = config.seedPhrase && normalizeMnemonic(config.seedPhrase)
  envCache = mnemonic && validateMnemonic(mnemonic, wordlist) ? { ...account(mnemonic, "", config.derivationPath), path: config.derivationPath } : null
  return envCache
}

const listeners = new Set<() => void>()
/** Notified when wallets are added, renamed or removed (the stream re-sends the list, sync restarts). */
export const onWalletsChange = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
const changed = () => listeners.forEach((l) => l())

type Row = { id: string; name: string; kind: string; xpub: string; path: string; fingerprint: number; encSeed: string | null; passphrase: boolean }
const info = (w: Row): WalletInfo => ({
  id: w.id,
  name: w.name,
  kind: w.kind as WalletKind,
  xpub: w.xpub,
  path: w.path,
  fingerprint: w.fingerprint,
  watchOnly: w.kind === "watch",
  needsPassword: w.kind === "seed",
  passphrase: w.passphrase,
})

/** Keep the env wallet row in step with .env; if its seed changed, drop the old seed's cached data. */
async function syncEnvWallet() {
  const env = envAccount()
  if (!env) return
  const xpub = env.account.publicExtendedKey
  const row = await db.wallet.findUnique({ where: { id: ENV_WALLET_ID } })
  if (row?.xpub === xpub && row.path === env.path) return
  if (row) await wipeCache(ENV_WALLET_ID)
  await db.wallet.upsert({
    where: { id: ENV_WALLET_ID },
    create: { id: ENV_WALLET_ID, name: "Default wallet", kind: "env", xpub, path: env.path, fingerprint: env.fingerprint },
    update: { xpub, path: env.path, fingerprint: env.fingerprint },
  })
}

const wipeCache = (walletId: string) =>
  db.$transaction([
    db.address.deleteMany({ where: { walletId } }),
    db.addressState.deleteMany({ where: { walletId } }),
    db.utxo.deleteMany({ where: { walletId } }),
    db.tx.deleteMany({ where: { walletId } }),
  ])

/** All usable wallets (the env wallet only while .env has a valid seed), oldest first. */
export async function listWallets(): Promise<WalletInfo[]> {
  await syncEnvWallet()
  const rows = await db.wallet.findMany({ orderBy: { createdAt: "asc" } })
  return rows.filter((r) => r.kind !== "env" || envAccount()).map(info)
}

export async function getWallet(id: unknown): Promise<WalletInfo> {
  const w = typeof id === "string" ? (await listWallets()).find((x) => x.id === id) : undefined
  if (!w) throw new WalletError("Unknown wallet")
  return w
}

function checkName(name: unknown) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40) throw new WalletError("Give the wallet a name (up to 40 characters)")
  return name.trim()
}
function checkPath(path: unknown) {
  const p = typeof path === "string" && path.trim() ? path.trim() : "m/84'/0'/0'"
  if (!DERIVATION_PATH.test(p)) throw new WalletError("Invalid derivation path")
  return p
}

/** New software wallet from recovery words (generated in the app or imported). The seed is sealed with `password`. */
export async function createSeedWallet(o: { name: unknown; mnemonic: unknown; passphrase?: unknown; path?: unknown; password: unknown }) {
  const name = checkName(o.name)
  const mnemonic = typeof o.mnemonic === "string" ? normalizeMnemonic(o.mnemonic) : ""
  if (!validateMnemonic(mnemonic, wordlist)) throw new WalletError("Invalid recovery words (BIP39 English, 12–24 words)")
  const passphrase = typeof o.passphrase === "string" ? o.passphrase : ""
  const path = checkPath(o.path)
  if (typeof o.password !== "string" || o.password.length < 8) throw new WalletError("Wallet password must be at least 8 characters")
  const { account: acct, fingerprint } = account(mnemonic, passphrase, path)
  const id = randomUUID()
  await db.wallet.create({
    data: {
      id,
      name,
      kind: "seed",
      xpub: acct.publicExtendedKey,
      path,
      fingerprint,
      passphrase: !!passphrase,
      encSeed: await seal(JSON.stringify({ mnemonic, passphrase }), o.password),
    },
  })
  changed()
  return getWallet(id)
}

/** Watch-only wallet from an account xpub/zpub. The master fingerprint is optional (needed only by external signers). */
export async function importWatchWallet(o: { name: unknown; xpub: unknown; path?: unknown; fingerprint?: unknown }) {
  const name = checkName(o.name)
  let xpub: string
  try {
    xpub = normalizeXpub(String(o.xpub ?? ""))
  } catch (e) {
    throw new WalletError((e as Error).message)
  }
  const fp = typeof o.fingerprint === "string" && o.fingerprint.trim() ? o.fingerprint.trim() : ""
  if (fp && !/^[0-9a-fA-F]{8}$/.test(fp)) throw new WalletError("Master fingerprint is 8 hex characters")
  const id = randomUUID()
  await db.wallet.create({ data: { id, name, kind: "watch", xpub, path: checkPath(o.path), fingerprint: fp ? parseInt(fp, 16) : 0 } })
  changed()
  return getWallet(id)
}

export async function renameWallet(id: unknown, name: unknown) {
  const w = await getWallet(id)
  await db.wallet.update({ where: { id: w.id }, data: { name: checkName(name) } })
  changed()
}

/** Remove a wallet and everything cached for it. The env wallet is managed by .env. */
export async function deleteWallet(id: unknown) {
  const w = await getWallet(id)
  if (w.kind === "env") throw new WalletError("The default wallet comes from .env: remove SEED_PHRASE there instead")
  await wipeCache(w.id)
  await db.$transaction([db.label.deleteMany({ where: { walletId: w.id } }), db.wallet.delete({ where: { id: w.id } })])
  changed()
}

/**
 * Keys for signing. env: from .env; seed: decrypted with the wallet password, in memory for this call only;
 * watch: refused.
 */
export async function signingAccount(id: unknown, password?: unknown) {
  const w = await getWallet(id)
  if (w.kind === "watch") throw new WatchOnlyError()
  let acct: HDKey
  if (w.kind === "env") acct = envAccount()!.account
  else {
    if (typeof password !== "string" || !password) throw new WalletError("Enter the wallet password to sign")
    const row = await db.wallet.findUniqueOrThrow({ where: { id: w.id } })
    const { mnemonic, passphrase } = JSON.parse(await unseal(row.encSeed!, password)) as { mnemonic: string; passphrase: string }
    acct = account(mnemonic, passphrase, w.path).account
  }
  return {
    fingerprint: w.fingerprint,
    accountPath: w.path,
    keyFor: (change: number, index: number) => {
      const k = acct.deriveChild(change).deriveChild(index)
      return { privateKey: k.privateKey!, publicKey: k.publicKey! }
    },
  }
}
