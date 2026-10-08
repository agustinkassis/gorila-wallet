import "server-only"
import { bytesToHex } from "@noble/hashes/utils.js"
import { db } from "@/lib/server/db"
import { chainFor } from "@/lib/server/watcher"
import { BLAKE_MAX_SCRIPT, addressFor, isDataScript, parseTxHex } from "@/lib/tx"
import { SIGHASH_UNIFIED } from "@/lib/unified-sighash"
import { CHAINS, addressScript, type Chain, type Fees } from "@/lib/wallet"

export type Status = "pass" | "warn" | "fail"
export type ReplayInput = {
  txid: string
  vout: number
  value: number | null
  address: string | null
  ours: boolean
  onTarget: "unspent" | "spent" | "missing" | "unknown"
  sighash: number | null
  status: Status
  note: string
}
export type ReplayOutput = { address: string | null; amount: number; data: boolean; scriptSize: number; status: Status; note: string }
export type ReplayCheck = { id: string; label: string; status: Status; detail: string }
export type ReplayAnalysis = {
  from: Chain
  to: Chain
  txid: string
  hex: string
  fee: number | null
  vsize: number
  feeRate: number | null
  targetHeight: number
  targetFees: Fees | null
  inputs: ReplayInput[]
  outputs: ReplayOutput[]
  checks: ReplayCheck[]
  replayable: boolean
}

const LOCKTIME_THRESHOLD = 500_000_000
/** Blake reduced_data consensus: OP_RETURN scripts ≤ 83 bytes, any other output script ≤ 34 bytes. */
const BLAKE_MAX_DATA_SCRIPT = 83

function outputOnTarget(to: Chain, script: Uint8Array): { status: Status; note: string } {
  if (to === "btc") return { status: "pass", note: "valid on Bitcoin" }
  const data = isDataScript(script)
  const max = data ? BLAKE_MAX_DATA_SCRIPT : BLAKE_MAX_SCRIPT
  return script.length > max
    ? { status: "fail", note: `${script.length}-byte ${data ? "OP_RETURN" : "script"}: Blake allows ≤ ${max}` }
    : { status: "pass", note: "valid on Blake" }
}

/**
 * Can `txid` (confirmed or pending on `from`) be rebroadcast as-is on the other chain?
 * Same bytes, same signatures: it is valid there only if every input's coin exists unspent there,
 * the signatures don't opt into SIGHASH_UNIFIED when going to Bitcoin, every output satisfies the
 * target's consensus rules, and the locktime is already final there.
 * Only this wallet's own coins may be replayed: replaying someone else's tx would move their funds.
 */
export async function analyzeReplay(walletId: string, from: Chain, txid: string): Promise<ReplayAnalysis> {
  const to: Chain = from === "btc" ? "xbt" : "btc"
  const [src, dst] = await Promise.all([chainFor(from), chainFor(to)])
  const hex = await src.rawHex(txid)
  const tx = parseTxHex(hex)
  const T = CHAINS[to].label

  const [ours, targetUtxos] = await Promise.all([
    db.address.findMany({ where: { walletId }, select: { address: true } }).then((rows) => new Set(rows.map((r) => bytesToHex(addressScript(r.address))))),
    db.utxo.findMany({ where: { walletId, chain: to }, select: { txid: true, vout: true } }).then((rows) => new Set(rows.map((u) => `${u.txid}:${u.vout}`))),
  ])
  const existsOnTarget = (id: string) =>
    dst.rawHex(id).then(
      () => true,
      () => false,
    )

  let totalIn: number | null = 0
  const inputs: ReplayInput[] = []
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i)
    const prevId = bytesToHex(inp.txid!)
    const vout = inp.index!
    const prev = await src
      .getTx(prevId)
      .then((p) => p.getOutput(vout))
      .catch(() => null)
    const script = prev?.script ?? null
    const value = prev?.amount !== undefined ? Number(prev.amount) : null
    if (value === null) totalIn = null
    else if (totalIn !== null) totalIn += value
    const isOurs = !!script && ours.has(bytesToHex(script))
    const sig = inp.finalScriptWitness?.[0]
    const sighash = sig?.length ? sig[sig.length - 1] : null
    const onTarget: ReplayInput["onTarget"] = !isOurs
      ? "unknown"
      : targetUtxos.has(`${prevId}:${vout}`)
        ? "unspent"
        : (await existsOnTarget(prevId))
          ? "spent"
          : "missing"

    let status: Status = "pass"
    let note = `unspent on ${T}`
    if (!isOurs) [status, note] = ["fail", "not this wallet's coin"]
    else if (onTarget === "spent") [status, note] = ["fail", `already spent on ${T}`]
    else if (onTarget === "missing") [status, note] = ["fail", `doesn't exist on ${T} (post-fork coin)`]
    else if (to === "btc" && sighash !== null && sighash & SIGHASH_UNIFIED) [status, note] = ["fail", "SIGHASH_UNIFIED: Bitcoin rejects it"]
    inputs.push({ txid: prevId, vout, value, address: script ? (addressFor(script) ?? null) : null, ours: isOurs, onTarget, sighash, status, note })
  }

  let totalOut = 0
  const outputs: ReplayOutput[] = Array.from({ length: tx.outputsLength }, (_, i) => {
    const o = tx.getOutput(i)
    totalOut += Number(o.amount ?? 0n)
    const rule = outputOnTarget(to, o.script!)
    return { address: addressFor(o.script!) ?? null, amount: Number(o.amount ?? 0n), data: isDataScript(o.script!), scriptSize: o.script!.length, ...rule }
  })

  const fee = totalIn === null ? null : totalIn - totalOut
  const vsize = tx.vsize
  const feeRate = fee === null ? null : fee / vsize
  const targetHeight = dst.height
  const targetFees = dst.fees
  const alreadyThere = await existsOnTarget(txid)

  // nLockTime only binds when some input's nSequence isn't final
  const lockTime = tx.lockTime
  const lockActive = lockTime > 0 && inputs.length > 0 && Array.from({ length: tx.inputsLength }, (_, i) => tx.getInput(i).sequence ?? 0xffffffff).some((s) => s !== 0xffffffff)
  const lockFinal = !lockActive || (lockTime < LOCKTIME_THRESHOLD ? lockTime <= targetHeight : lockTime <= Date.now() / 1000)

  const all = (s: { status: Status }[]) => (s.every((x) => x.status === "pass") ? "pass" : "fail")
  const sigProtected = inputs.some((i) => to === "btc" && i.sighash !== null && i.sighash & SIGHASH_UNIFIED)
  const checks: ReplayCheck[] = [
    {
      id: "ours",
      label: "Inputs belong to this wallet",
      status: inputs.every((i) => i.ours) ? "pass" : "fail",
      detail: inputs.every((i) => i.ours) ? "Every input spends one of your coins." : "Replaying would move someone else's coins, so it isn't offered.",
    },
    {
      id: "coins",
      label: `Coins exist unspent on ${T}`,
      status: inputs.every((i) => i.onTarget === "unspent") ? "pass" : "fail",
      detail: inputs.every((i) => i.onTarget === "unspent")
        ? "These are pre-fork coins still unspent on the other chain."
        : `${inputs.filter((i) => i.onTarget !== "unspent").length} of ${inputs.length} inputs are spent, missing or unknown on ${T}.`,
    },
    {
      id: "signatures",
      label: "Signatures are valid there",
      status: sigProtected ? "fail" : "pass",
      detail: sigProtected
        ? "Signed with SIGHASH_UNIFIED (0x21): replay-protected, Bitcoin computes a different message and rejects it."
        : to === "xbt"
          ? "Ordinary Bitcoin signatures (no SIGHASH_UNIFIED) are valid on Blake."
          : "Legacy-signed (no SIGHASH_UNIFIED), so Bitcoin accepts the signatures.",
    },
    {
      id: "outputs",
      label: `Outputs follow ${T} consensus`,
      status: all(outputs),
      detail:
        all(outputs) === "pass"
          ? to === "xbt"
            ? "Every output fits Blake's size limits (OP_RETURN ≤ 83 bytes, scripts ≤ 34 bytes)."
            : "Bitcoin accepts every output."
          : outputs.find((o) => o.status === "fail")!.note,
    },
    {
      id: "locktime",
      label: "Locktime is final",
      status: lockFinal ? "pass" : "fail",
      detail: !lockActive
        ? "No locktime."
        : lockFinal
          ? `nLockTime ${lockTime.toLocaleString()} is already final on ${T} (tip ${targetHeight.toLocaleString()}).`
          : `nLockTime ${lockTime.toLocaleString()} is in the future on ${T} (tip ${targetHeight.toLocaleString()}): it can't confirm yet.`,
    },
    {
      id: "fresh",
      label: `Not already on ${T}`,
      status: alreadyThere ? "fail" : "pass",
      detail: alreadyThere ? `This exact transaction is already on ${T}.` : `${T} hasn't seen this transaction.`,
    },
    {
      id: "fee",
      label: "Fee is enough there",
      status:
        feeRate === null || !targetFees ? "warn" : feeRate < targetFees.minimumFee ? "fail" : feeRate < targetFees.hourFee ? "warn" : "pass",
      detail:
        feeRate === null
          ? "Fee unknown."
          : !targetFees
            ? `${feeRate.toFixed(1)} sat/vB; no ${T} estimate available.`
            : `${feeRate.toFixed(1)} sat/vB vs ${T} estimates: 1 h ${targetFees.hourFee}, minimum ${targetFees.minimumFee} sat/vB. The fee can't change: it's the same signed bytes.`,
    },
  ]

  return {
    from,
    to,
    txid,
    hex,
    fee,
    vsize,
    feeRate,
    targetHeight,
    targetFees,
    inputs,
    outputs,
    checks,
    replayable: checks.every((c) => c.status !== "fail"),
  }
}
