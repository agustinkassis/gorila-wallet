// SIGHASH_UNIFIED (Bitcoin Knots v29.4.1+, BLAKE2b chain): doc/unified-sighash.md.
// One BIP341-shaped message for every script type, tagged "UnifiedSighash". Signatures that set the
// 0x20 bit are invalid on chains that don't implement it, which is Blake's replay protection.
import { sha256 } from "@noble/hashes/sha2.js"
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js"

export const SIGHASH_UNIFIED = 0x20
export const SIGHASH_ALL_UNIFIED = 0x21 // SIGHASH_ALL | SIGHASH_UNIFIED

const SIGHASH_NONE = 0x02
const SIGHASH_SINGLE = 0x03
const ANYONECANPAY = 0x80

export type UnifiedInput = { txid: Uint8Array /* display (big-endian) order */; index: number; sequence: number }
export type UnifiedOutput = { amount: bigint; script: Uint8Array }
export type UnifiedTx = { version: number; lockTime: number; inputs: UnifiedInput[]; outputs: UnifiedOutput[] }
/** 0 bare/P2SH, 1 segwit v0, 2 taproot key path, 3 tapscript */
export type ScriptType = 0 | 1 | 2 | 3

const u32 = (n: number) => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}
const i64 = (n: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigInt64(0, n, true)
  return b
}
function compactSize(n: number) {
  if (n < 0xfd) return Uint8Array.of(n)
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8)
  return concatBytes(Uint8Array.of(0xfe), u32(n))
}
const varBytes = (b: Uint8Array) => concatBytes(compactSize(b.length), b)
const outpoint = (i: UnifiedInput) => concatBytes(i.txid.slice().reverse(), u32(i.index))
const output = (o: UnifiedOutput) => concatBytes(i64(o.amount), varBytes(o.script))

export function taggedHash(tag: string, msg: Uint8Array) {
  const t = sha256(utf8ToBytes(tag))
  return sha256(concatBytes(t, t, msg))
}

/**
 * Signature hash for input `idx`. `spent` holds every input's spent output, in input order.
 * `scriptCode`: the implied P2PKH script for P2WPKH (type 1), the script for type 0, the leaf script for type 3.
 * Assumes no annex and no executed OP_CODESEPARATOR (all this wallet produces).
 */
export function unifiedSighash(
  tx: UnifiedTx,
  idx: number,
  spent: UnifiedOutput[],
  hashType: number,
  scriptType: ScriptType,
  scriptCode = new Uint8Array(),
) {
  if (!(hashType & SIGHASH_UNIFIED)) throw new Error("hash type does not opt in to SIGHASH_UNIFIED")
  if (spent.length !== tx.inputs.length) throw new Error("need one spent output per input")
  const base = hashType & 0x1f
  const acp = (hashType & ANYONECANPAY) !== 0
  const parts: Uint8Array[] = [
    Uint8Array.of(0, hashType & 0xff), // epoch, hash type
    u32(tx.version),
    u32(tx.lockTime),
    Uint8Array.of(0), // locktime is 5 bytes, zero-extended
  ]
  if (!acp) {
    parts.push(
      sha256(concatBytes(...tx.inputs.map(outpoint))),
      sha256(concatBytes(...spent.map((o) => i64(o.amount)))),
      sha256(concatBytes(...spent.map((o) => varBytes(o.script)))),
      sha256(concatBytes(...tx.inputs.map((i) => u32(i.sequence)))),
    )
  }
  if (base !== SIGHASH_NONE && base !== SIGHASH_SINGLE) parts.push(sha256(concatBytes(...tx.outputs.map(output))))
  parts.push(Uint8Array.of(scriptType))
  if (acp) parts.push(outpoint(tx.inputs[idx]), output(spent[idx]), u32(tx.inputs[idx].sequence))
  else parts.push(u32(idx))
  if (scriptType <= 1) parts.push(varBytes(scriptCode))
  else parts.push(Uint8Array.of(0)) // no annex
  if (base === SIGHASH_SINGLE) {
    if (idx >= tx.outputs.length) throw new Error("SIGHASH_SINGLE without a matching output")
    parts.push(sha256(output(tx.outputs[idx])))
  }
  if (scriptType === 3) {
    parts.push(taggedHash("TapLeaf", concatBytes(Uint8Array.of(0xc0), varBytes(scriptCode))), Uint8Array.of(0), u32(0xffffffff))
  }
  return taggedHash("UnifiedSighash", concatBytes(...parts))
}
