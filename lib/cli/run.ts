import { generateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { CliError, parseArgs, positiveInteger, selectWallet, type Args } from "@/lib/cli/args"
import { secret, confirm } from "@/lib/cli/input"
import { config } from "@/lib/server/config"
import { db } from "@/lib/server/db"
import { getSettings, parseSettings, saveSettings } from "@/lib/server/settings"
import { createSeedWallet, exportSeed, exportDescriptors, listWallets } from "@/lib/server/wallets"
import { receiveAddress } from "@/lib/server/receive"
import { setLabel } from "@/lib/server/labels"
import { openSyncSession } from "@/lib/server/watcher"
import { signPsbt } from "@/lib/server/signer"
import { broadcastHex, validateBroadcast } from "@/lib/server/broadcast"
import { deriveAddress, type WalletInfo, type Snapshot } from "@/lib/wallet"
import { CHAINS, type Chain } from "@/lib/chains"
import { buildPsbt, feeAt, planTx, type Coin } from "@/lib/tx"

export const HELP = `gorila - Bitcoin (BTC) and Blake2b (XBT), amounts in satoshis

wallet list
wallet create --name NAME [--words 12|24] [--password-file FILE] [--passphrase-file FILE]
wallet import --name NAME [--seed-file FILE] [--password-file FILE] [--passphrase-file FILE]
wallet export-seed [--include-passphrase] [--password-file FILE]
wallet descriptor
receive [--next] [--label TEXT]
addresses
address label ADDRESS TEXT
balance [--chain btc|xbt|all] [--all-wallets]
transactions --chain btc|xbt
tx-status TXID --chain btc|xbt
config show
config set --chain btc|xbt [--electrum URL ...] [--mempool URL ...]
send --chain btc|xbt --to ADDRESS --amount-sats N [--message TEXT] [--fee-rate N] [--yes]

Common: --wallet ID_OR_NAME, --json, --timeout SECONDS (default 120), --help
Secrets use hidden terminal prompts or explicit files. --passphrase prompts for a BIP39 passphrase.
`

const commandOptions: Record<string, readonly string[]> = {
  "wallet list": [],
  "wallet create": ["name", "words", "password-file", "passphrase-file", "passphrase"],
  "wallet import": ["name", "seed-file", "password-file", "passphrase-file", "passphrase"],
  "wallet export-seed": ["password-file", "include-passphrase"],
  "wallet descriptor": [],
  receive: ["label", "next"], addresses: [], "address label": [],
  balance: ["chain", "all-wallets"], transactions: ["chain"], "tx-status": ["chain"],
  "config show": [], "config set": ["chain", "electrum", "mempool"],
  send: ["chain", "to", "amount-sats", "message", "fee-rate", "yes", "password-file"],
}
function required(args: Args, name: string) {
  const value = args.value(name)
  if (value === undefined || value === "") throw new CliError(`--${name} is required`)
  return value
}
function chainArg(args: Args): "btc" | "xbt" {
  const chain = args.value("chain")
  if (chain !== "btc" && chain !== "xbt") throw new CliError("--chain must be btc or xbt")
  return chain
}
const walletResult = (w: WalletInfo) => ({ id: w.id, name: w.name, kind: w.kind, watchOnly: w.watchOnly, needsPassword: w.needsPassword, passphrase: w.passphrase })
const confirmations = (height: number, tip: number) => height > 0 ? Math.max(0, tip - height + 1) : 0

async function transactionStatus(txid: string, chain: "btc" | "xbt", snapshots: Snapshot[], timeoutMs: number) {
  const snapshot = snapshots.find((s) => s.chain === chain)
  const tx = snapshot?.txs.find((t) => t.txid === txid)
  if (tx && snapshot) return { chain, txid, found: true, confirmed: tx.height > 0, height: tx.height > 0 ? tx.height : null, confirmations: confirmations(tx.height, snapshot.height) }
  const sources = config.sources(chain, await getSettings()).mempool
  let missing = false
  const errors: string[] = []
  for (const base of sources) {
    try {
      const res = await fetch(`${base}/api/tx/${txid}/status`, { signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)) })
      if (res.status === 404) { missing = true; continue }
      if (!res.ok) throw new CliError(`HTTP ${res.status}`)
      const status: unknown = await res.json()
      if (!status || typeof status !== "object" || !("confirmed" in status) || typeof status.confirmed !== "boolean") throw new CliError("Malformed transaction status")
      if (!status.confirmed) return { chain, txid, found: true, confirmed: false, height: null, confirmations: 0 }
      if (!("block_height" in status) || typeof status.block_height !== "number" || !Number.isSafeInteger(status.block_height) || status.block_height <= 0) throw new CliError("Malformed block height")
      const tipResponse = await fetch(`${base}/api/blocks/tip/height`, { signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)) })
      if (!tipResponse.ok) throw new CliError(`Tip HTTP ${tipResponse.status}`)
      const tip = Number(await tipResponse.text())
      if (!Number.isSafeInteger(tip) || tip < status.block_height) throw new CliError("Malformed chain tip")
      return { chain, txid, found: true, confirmed: true, height: status.block_height, confirmations: confirmations(status.block_height, tip) }
    } catch (error) { errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  if (missing) return { chain, txid, found: false }
  throw new CliError(`Transaction status servers inaccessible: ${errors.join("; ") || "no sources configured"}`)
}

export async function runCli(argv: readonly string[]) {
  const args = parseArgs(argv)
  if (args.flags.has("help") || !args.positionals.length) return { help: HELP }
  const first = args.positionals[0]
  const grouped = ["wallet", "config", "address"].includes(first)
  const command = grouped ? args.positionals.slice(0, 2).join(" ") : first
  const allowed = commandOptions[command]
  if (!allowed) throw new CliError(`Unknown command: ${command}. Use --help`)
  const common = ["wallet", "json", "timeout", "help"]
  for (const option of [...Object.keys(args.values), ...args.flags]) {
    if (!common.includes(option) && !allowed.includes(option)) throw new CliError(`--${option} is not valid for ${command}`)
  }
  const positionalCount = command === "address label" ? 4 : command === "tx-status" ? 2 : grouped ? 2 : 1
  if (args.positionals.length !== positionalCount) throw new CliError(`Invalid arguments for ${command}. Use --help`)
  const timeoutMs = positiveInteger(args.value("timeout") ?? "120", "timeout") * 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 2_147_483_647) throw new CliError("timeout is too large")
  if (command === "config show") {
    const settings = await getSettings()
    return { chains: (["btc", "xbt"] as const).map((chain) => {
      const sources = config.sources(chain, settings)
      const origin = (kind: "electrum" | "mempool", env: string) => settings.sources[chain]?.[kind]?.length ? "Settings" : process.env[env]?.split(",").some((v) => v.trim()) ? ".env/environment" : "defaults"
      return { chain, electrum: { urls: sources.electrum, source: origin("electrum", `${chain.toUpperCase()}_ELECTRUM`) }, mempool: { urls: sources.mempool, source: origin("mempool", `MEMPOOL_${chain.toUpperCase()}_URL`) } }
    }) }
  }
  if (command === "config set") {
    const chain = chainArg(args)
    if (!args.values.electrum && !args.values.mempool) throw new CliError("Supply --electrum or --mempool")
    const settings = await getSettings()
    const patch = parseSettings({ sources: { ...settings.sources, [chain]: { ...settings.sources[chain], ...(args.values.electrum ? { electrum: args.values.electrum } : {}), ...(args.values.mempool ? { mempool: args.values.mempool } : {}) } } })
    await saveSettings(patch)
    return { chain, ...config.sources(chain, await getSettings()) }
  }
  if (command === "wallet create" || command === "wallet import") {
    const name = required(args, "name")
    const words = args.value("words") ?? "24"
    if (words !== "12" && words !== "24") throw new CliError("--words must be 12 or 24")
    const mnemonic = command === "wallet create" ? generateMnemonic(wordlist, words === "12" ? 128 : 256) : await secret(args.value("seed-file"), "BIP39 recovery words")
    if (![12, 24].includes(mnemonic.trim().split(/\s+/).length)) throw new CliError("Recovery words must have 12 or 24 words")
    const password = await secret(args.value("password-file"), "Wallet password (empty for none)", false)
    const passphrase = args.value("passphrase-file") || args.flags.has("passphrase") ? await secret(args.value("passphrase-file"), "BIP39 passphrase") : ""
    const wallet = await createSeedWallet({ name, mnemonic, password, passphrase })
    return { wallet: walletResult(wallet), ...(command === "wallet create" ? { mnemonic } : {}) }
  }
  const wallets = await listWallets()
  if (command === "wallet list") return { wallets: wallets.map(walletResult) }
  if (command === "balance" && args.flags.has("all-wallets") && args.value("wallet")) throw new CliError("Use --all-wallets or --wallet")
  const selected = command === "balance" && args.flags.has("all-wallets") ? wallets : command === "tx-status" && !wallets.length ? [] : [selectWallet(wallets, args.value("wallet"))]
  const wallet = selected[0]
  if (wallet && !wallet.accounts.main && !command.startsWith("wallet ")) throw new CliError("Wallet has no mainnet account for BTC/XBT")
  if (command === "wallet export-seed") {
    if (!wallet) throw new CliError("No wallet selected")
    const password = wallet.needsPassword || args.value("password-file") ? await secret(args.value("password-file"), "Wallet password") : ""
    return exportSeed(wallet.id, password, args.flags.has("include-passphrase"))
  }
  if (command === "wallet descriptor") {
    if (!wallet) throw new CliError("No wallet selected")
    const account = wallet.accounts.main
    if (!account) throw new CliError("Wallet has no mainnet account for BTC/XBT")
    return { walletId: wallet.id, family: "main", fingerprint: account.fingerprint.toString(16).padStart(8, "0"), path: account.path, xpub: account.xpub, ...await exportDescriptors(wallet.id, "main") }
  }
  if (command === "address label") {
    if (!wallet) throw new CliError("No wallet selected")
    const address = args.positionals[2]
    if (!await db.address.findUnique({ where: { walletId_address: { walletId: wallet.id, address } } })) throw new CliError("Address does not belong to this wallet; run addresses to discover it")
    await setLabel(wallet.id, "all", "addr", address, args.positionals[3], null)
    return { walletId: wallet.id, address, label: args.positionals[3] }
  }
  let chains: Chain[] = ["btc", "xbt"]
  if (command === "balance") {
    const requested = args.value("chain") ?? "all"
    if (requested !== "all" && requested !== "btc" && requested !== "xbt") throw new CliError("--chain must be btc, xbt or all")
    chains = requested === "all" ? ["btc", "xbt"] : [requested]
  } else if (["transactions", "tx-status", "send"].includes(command)) chains = [chainArg(args)]
  if (command === "tx-status" && !/^[0-9a-f]{64}$/i.test(args.positionals[1])) throw new CliError("TXID must be 64 hex characters")
  if (command === "send") {
    if (!wallet || wallet.watchOnly) throw new CliError("Watch-only wallets cannot sign")
    required(args, "to")
    positiveInteger(required(args, "amount-sats"), "amount-sats")
    if (chains[0] === "xbt" && args.value("message") !== undefined) throw new CliError("XBT does not support --message")
    if (args.value("fee-rate") !== undefined && (!Number.isFinite(Number(args.value("fee-rate"))) || Number(args.value("fee-rate")) < 1 || Number(args.value("fee-rate")) > 1000)) throw new CliError("fee-rate must be between 1 and 1000 sat/vB")
    if (!args.flags.has("yes") && !process.stdin.isTTY) throw new CliError("Sending requires terminal confirmation or --yes")
  }
  const session = selected.length ? await openSyncSession(selected, chains, timeoutMs) : undefined
  try {
    const snapshots = session?.snapshots() ?? []
    if (command === "tx-status") return transactionStatus(args.positionals[1].toLowerCase(), chainArg(args), snapshots, timeoutMs)
    if (command === "balance") return { balances: snapshots.map((s) => {
      const confirmed = s.addresses.reduce((n, a) => n + a.confirmed, 0)
      const pending = s.addresses.reduce((n, a) => n + a.unconfirmed, 0)
      return { walletId: s.walletId, chain: s.chain, currency: CHAINS[s.chain].unit, confirmed, pending, total: confirmed + pending }
    }) }
    if (!wallet) throw new CliError("No wallet selected")
    if (command === "receive") return { walletId: wallet.id, ...await receiveAddress(wallet.id, "btc", { next: args.flags.has("next"), label: args.value("label") }) }
    if (command === "addresses") {
      const [addresses, states, labels] = await Promise.all([
        db.address.findMany({ where: { walletId: wallet.id, family: "main" }, orderBy: [{ change: "asc" }, { index: "asc" }] }),
        db.addressState.findMany({ where: { walletId: wallet.id, chain: { in: ["btc", "xbt"] } } }),
        db.label.findMany({ where: { walletId: wallet.id, type: "addr", chain: "all" } }),
      ])
      return { walletId: wallet.id, addresses: addresses.map((a) => ({ address: a.address, index: a.index, change: a.change, label: labels.find((l) => l.ref === a.address)?.label ?? null, chains: (["btc", "xbt"] as const).map((chain) => {
        const state = states.find((s) => s.address === a.address && s.chain === chain)
        const history: [string, number][] = JSON.parse(state?.history ?? "[]")
        return { chain, used: state?.used ?? false, transactions: new Set(history.map(([txid]) => txid)).size }
      }) })) }
    }
    const snapshot = snapshots[0]
    if (!snapshot || !session) throw new CliError("No synchronized wallet")
    if (command === "transactions") return { walletId: wallet.id, chain: snapshot.chain, transactions: [...snapshot.txs].sort((a, b) => (b.time ?? Infinity) - (a.time ?? Infinity)).map((t) => ({ ...t, date: t.time ? new Date(t.time * 1000).toISOString() : null, confirmations: confirmations(t.height, snapshot.height) })) }
    if (command !== "send") throw new CliError("Unsupported command")
    const chain = chainArg(args)
    const client = session.client(chain)
    if (!args.value("fee-rate")) {
      try { await client.waitForFees(Math.min(timeoutMs, 20_000)) }
      catch (error) { throw new CliError(`No fee estimate available: supply --fee-rate (${error instanceof Error ? error.message : String(error)})`) }
    }
    const rate = args.value("fee-rate") ? Number(args.value("fee-rate")) : client.fees?.hourFee
    if (!rate || !Number.isFinite(rate) || rate < 1) throw new CliError("No fee estimate available: supply --fee-rate")
    if (client.fees && rate < client.fees.minimumFee) throw new CliError(`fee-rate is below the network minimum (${client.fees.minimumFee} sat/vB)`)
    const account = wallet.accounts.main
    if (!account) throw new CliError("Wallet has no mainnet account")
    const candidates: Coin[] = snapshot.utxos.filter((u) => !u.frozen).map((u) => {
      const address = snapshot.addresses.find((a) => a.address === u.address)
      if (!address) throw new CliError("UTXO address was not discovered")
      return { ...u, change: address.change, index: address.index }
    })
    const usedChange = await db.addressState.findMany({ where: { walletId: wallet.id, chain: { in: ["btc", "xbt"] }, used: true }, select: { address: true } })
    const used = new Set(usedChange.map((a) => a.address))
    let changeIndex = 0
    while (used.has(deriveAddress(account.xpub, 1, changeIndex, "main").address)) changeIndex++
    const plan = planTx({ chain, recipients: [{ address: required(args, "to"), amount: positiveInteger(args.value("amount-sats"), "amount-sats") }], candidates, fee: feeAt(rate), changeAddress: deriveAddress(account.xpub, 1, changeIndex, "main").address, ...(chain === "btc" ? { data: new TextEncoder().encode(args.value("message") ?? "") } : {}) })
    const review = { walletId: wallet.id, chain, inputs: plan.inputs, outputs: plan.outputs.map((o) => ({ kind: o.kind, address: o.address ?? null, amount: o.amount, script: bytesToHex(o.script) })), fee: plan.fee, vsize: plan.vsize, feeRate: rate }
    process.stderr.write(`${JSON.stringify(review, null, 2)}\n`)
    if (!args.flags.has("yes")) await confirm()
    const password = wallet.needsPassword || args.value("password-file") ? await secret(args.value("password-file"), "Wallet password") : ""
    const psbt = buildPsbt(plan, { chain, xpub: account.xpub, fingerprint: account.fingerprint, accountPath: account.path, tipHeight: snapshot.height }).toPSBT()
    const signed = await signPsbt(wallet.id, chain, psbt, password, client)
    validateBroadcast(chain, signed.hex)
    const txid = await broadcastHex(client, signed.hex)
    return { chain, txid, fee: signed.fee, vsize: signed.vsize, review }
  } finally { await session?.close() }
}
