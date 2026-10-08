// Run: pnpm check  (react-server condition lets us import the server-only modules)
import assert from "node:assert/strict"
import fs from "node:fs"
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync } from "@scure/bip39"
import { RawTx, SigHash, Transaction, p2pkh, p2wpkh } from "@scure/btc-signer"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { finalizeEvent, generateSecretKey, getPublicKey, nip98 } from "nostr-tools"
import { deriveAddresses, parseCoins, scriptHash, txEvents, type Snapshot, type Tx } from "../lib/wallet"
import { buildPsbt, cpfpFee, feeAt, opReturnScript, outputRuleError, planTx, rbfFee, type Coin } from "../lib/tx"
import { SIGHASH_ALL_UNIFIED, unifiedSighash, type ScriptType } from "../lib/unified-sighash"
import { requireNostr } from "../lib/server/auth"
import { headerTime } from "../lib/server/watcher"
import { signWith, type SignContext } from "../lib/server/sign-core"

const throws = async (fn: () => unknown, re: RegExp) => {
  try {
    await fn()
  } catch (e) {
    return assert.match((e as Error).message, re)
  }
  assert.fail(`expected error ${re}`)
}

;(async () => {
  // --- Keys & addresses: BIP84 test vector -------------------------------------------------
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic))
  const account = master.derive("m/84'/0'/0'")
  const xpub = account.publicExtendedKey
  assert.deepEqual(deriveAddresses(xpub, 2), ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"])
  assert.equal(deriveAddresses(xpub, 1, 1)[0], "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el")
  assert.equal(scriptHash("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"), "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161")
  assert.equal(
    headerTime(
      "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c",
    ),
    1231006505,
  )
  assert.equal(parseCoins("0.0015"), 150_000)
  assert.equal(parseCoins("1"), 100_000_000)
  assert.equal(parseCoins("0.123456789"), null)
  assert.equal(parseCoins("abc"), null)

  // --- Incoming-tx events -----------------------------------------------------------------
  const snap = (txs: Tx[], synced = true): Snapshot => ({
    chain: "btc", connected: true, synced, server: null, height: 100, explorer: "", fees: null, addresses: [], utxos: [], txs,
  })
  const tx = (txid: string, height: number, amount: number): Tx => ({ txid, height, amount, time: null })
  const old = tx("old", 50, 1000)
  assert.deepEqual(txEvents(undefined, snap([old])), [])
  assert.deepEqual(txEvents(snap([], false), snap([old])), [])
  const kinds = (a: Tx[], b: Tx[]) => txEvents(snap(a), snap(b)).map((e) => `${e.kind}:${e.tx.txid}`)
  assert.deepEqual(kinds([old], [old, tx("in", 0, 500), tx("out", 0, -500)]), ["received:in"])
  assert.deepEqual(kinds([old, tx("in", 0, 500)], [old, tx("in", 101, 500)]), ["confirmed:in"])
  assert.deepEqual(kinds([old], [old, tx("fast", 101, 700)]), ["received:fast"])

  // --- SIGHASH_UNIFIED: all 166 Knots reference vectors -----------------------------------
  // scripts/vectors/unified_sighash.json: bitcoinknots/bitcoin v29.4.2.knots20260508, src/test/data (MIT)
  const vectors = JSON.parse(fs.readFileSync(new URL("./vectors/unified_sighash.json", import.meta.url), "utf8")).slice(1)
  for (const [scriptCode, raw, idx, hashType, scriptType, spentOutputs, expected] of vectors) {
    const t = RawTx.decode(hexToBytes(raw))
    const got = unifiedSighash(
      { version: t.version, lockTime: t.lockTime, inputs: t.inputs, outputs: t.outputs },
      idx,
      spentOutputs.map(([v, s]: [number, string]) => ({ amount: BigInt(v), script: hexToBytes(s) })),
      hashType,
      scriptType as ScriptType,
      hexToBytes(scriptCode),
    )
    assert.equal(bytesToHex(got), expected, `unified vector type ${scriptType} hashType ${hashType}`)
  }
  assert.equal(vectors.length, 166)

  // --- Planner: chain rules, OP_RETURN guard, coin selection, fee policies ---------------------
  const addr0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"
  const change0 = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"
  const dest = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"
  assert.equal(opReturnScript(new Uint8Array()).length, 84) // padded: Blake rejects > 83
  assert.ok(opReturnScript(new Uint8Array(500)).length > 84)
  assert.match(outputRuleError("xbt", opReturnScript(new Uint8Array()))!, /not allowed on Blake/)
  assert.match(outputRuleError("xbt", new Uint8Array(35))!, /34 bytes/)
  assert.match(outputRuleError("btc", Uint8Array.of(0x6a, 1, 0))!, /≥ 84/)
  assert.equal(outputRuleError("btc", opReturnScript(new Uint8Array(10))), null)

  const coin = (txid: string, value: number, height = 100): Coin => ({ txid, vout: 0, value, address: addr0, change: 0, index: 0, height })
  const coins = [coin("a".repeat(64), 50_000), coin("b".repeat(64), 20_000), coin("c".repeat(64), 5_000)]
  // single best-fit coin, with change
  let p = planTx({ chain: "btc", recipients: [{ address: dest, amount: 10_000 }], candidates: coins, fee: feeAt(2), changeAddress: change0 })
  assert.deepEqual(p.inputs.map((c) => c.value), [20_000])
  assert.equal(p.outputs.find((o) => o.kind === "change")!.amount + 10_000 + p.fee, 20_000)
  // changeless when the excess is smaller than a change output's cost
  p = planTx({ chain: "btc", recipients: [{ address: dest, amount: 4_700 }], candidates: coins, fee: feeAt(1), changeAddress: change0 })
  assert.equal(p.outputs.some((o) => o.kind === "change"), false)
  assert.equal(p.fee, 300)
  // accumulation when no single coin is enough
  p = planTx({ chain: "btc", recipients: [{ address: dest, amount: 60_000 }], candidates: coins, fee: feeAt(1), changeAddress: change0 })
  assert.equal(p.inputs.length, 2)
  // send max sweeps everything selected, no change
  p = planTx({ chain: "btc", recipients: [{ address: dest, amount: 0 }], sendMax: true, candidates: coins, fee: feeAt(1), changeAddress: change0 })
  assert.equal(p.outputs[0].amount + p.fee, 75_000)
  await throws(() => planTx({ chain: "btc", recipients: [{ address: dest, amount: 100 }], candidates: coins, fee: feeAt(1), changeAddress: change0 }), /dust/)
  await throws(() => planTx({ chain: "btc", recipients: [{ address: dest, amount: 1e9 }], candidates: coins, fee: feeAt(1), changeAddress: change0 }), /Insufficient/)
  await throws(() => planTx({ chain: "btc", recipients: [{ address: "nope", amount: 1e4 }], candidates: coins, fee: feeAt(1), changeAddress: change0 }), /Invalid address/)
  await throws(
    () => planTx({ chain: "xbt", recipients: [{ address: dest, amount: 1e4 }], candidates: coins, fee: feeAt(1), changeAddress: change0, data: new Uint8Array(1) }),
    /not allowed on Blake/,
  )
  p = planTx({ chain: "btc", recipients: [{ address: dest, amount: 10_000 }], candidates: coins, fee: feeAt(1), changeAddress: change0, data: new Uint8Array(3) })
  assert.ok(p.outputs.some((o) => o.kind === "data" && o.script.length === 84))
  // BIP125: replacement pays more than the original + its own relay cost; CPFP reaches the package rate
  assert.equal(rbfFee(2, 1000)(150), 1150)
  assert.equal(rbfFee(20, 1000)(150), 3000)
  assert.equal(cpfpFee(10, 200, 200)(110), 2900)

  // --- Signing round trip on both chains (BIP84 test seed) ----------------------------------
  const funding = new Transaction({ allowUnknownInputs: true })
  funding.addInput({ txid: "11".repeat(32), index: 0 })
  funding.addOutputAddress(addr0, 100_000n)
  const fundingId = funding.id
  const ctx = (overrides: Partial<SignContext> = {}): SignContext => ({
    fingerprint: master.fingerprint,
    accountPath: "m/84'/0'/0'",
    keyFor: (c, i) => {
      const k = account.deriveChild(c).deriveChild(i)
      return { privateKey: k.privateKey!, publicKey: k.publicKey! }
    },
    prevOut: async (txid, vout) => {
      assert.equal(txid, fundingId)
      return funding.getOutput(vout)
    },
    frozen: new Set(),
    ...overrides,
  })
  const fundCoin: Coin = { txid: fundingId, vout: 0, value: 100_000, address: addr0, change: 0, index: 0, height: 100 }
  const psbtFor = (chain: "btc" | "xbt", data?: Uint8Array) => {
    const plan = planTx({ chain, recipients: [{ address: dest, amount: 40_000 }], candidates: [fundCoin], fee: feeAt(3), changeAddress: change0, data })
    return buildPsbt(plan, { chain, xpub, fingerprint: master.fingerprint, accountPath: "m/84'/0'/0'", tipHeight: 970_000 }).toPSBT()
  }
  const pub0 = account.deriveChild(0).deriveChild(0).publicKey!

  const btc = await signWith("btc", psbtFor("btc", new Uint8Array(5)), ctx())
  let signed = Transaction.fromRaw(hexToBytes(btc.hex), { allowUnknownOutputs: true })
  let [sig, pub] = signed.getInput(0).finalScriptWitness!
  assert.equal(sig[sig.length - 1], SigHash.ALL)
  assert.deepEqual(pub, pub0)
  assert.ok(
    secp256k1.verify(sig.slice(0, -1), signed.preimageWitnessV0(0, p2pkh(pub0).script, SigHash.ALL, 100_000n), pub0, { prehash: false, format: "der" }),
    "BTC signature verifies against the BIP143 preimage",
  )
  assert.equal(signed.lockTime, 970_000)
  assert.equal(signed.getInput(0).sequence, 0xfffffffd)

  const xbt = await signWith("xbt", psbtFor("xbt"), ctx())
  signed = Transaction.fromRaw(hexToBytes(xbt.hex), { allowUnknownOutputs: true })
  ;[sig, pub] = signed.getInput(0).finalScriptWitness!
  assert.equal(sig[sig.length - 1], SIGHASH_ALL_UNIFIED, "Blake signature carries ALL|UNIFIED")
  const unsigned = {
    version: signed.version,
    lockTime: signed.lockTime,
    inputs: [{ txid: signed.getInput(0).txid!, index: 0, sequence: signed.getInput(0).sequence! }],
    outputs: Array.from({ length: signed.outputsLength }, (_, i) => signed.getOutput(i) as { amount: bigint; script: Uint8Array }),
  }
  const uh = unifiedSighash(unsigned, 0, [{ amount: 100_000n, script: p2wpkh(pub0).script }], SIGHASH_ALL_UNIFIED, 1, p2pkh(pub0).script)
  assert.ok(secp256k1.verify(sig.slice(0, -1), uh, pub0, { prehash: false, format: "der" }), "Blake signature verifies against the UNIFIED sighash")
  assert.ok(
    !secp256k1.verify(sig.slice(0, -1), signed.preimageWitnessV0(0, p2pkh(pub0).script, SIGHASH_ALL_UNIFIED, 100_000n), pub0, { prehash: false, format: "der" }),
    "…and not against Bitcoin's BIP143 message for the same byte (replay protection)",
  )

  // signer refusals
  await throws(() => signWith("btc", psbtFor("btc"), ctx({ frozen: new Set([`${fundingId}:0`]) })), /frozen/)
  await throws(() => signWith("btc", psbtFor("btc"), ctx({ fingerprint: 0x12345678 })), /not from this wallet/)
  await throws(() => signWith("btc", psbtFor("btc"), ctx({ prevOut: async () => ({ script: p2wpkh(pub0).script, amount: 99_999n }) })), /amount or script/)
  await throws(() => signWith("xbt", psbtFor("btc", new Uint8Array(5)), ctx()), /not allowed on Blake/)

  // --- NIP-98: allowlist + payload binding ------------------------------------------------------
  const url = "http://localhost:3000/api/stream"
  const allowed = generateSecretKey()
  process.env.ALLOWED_PUBKEYS = getPublicKey(allowed)
  const tokenFor = (sk: Uint8Array, u = url, method = "GET", body?: object) => nip98.getToken(u, method, (e) => finalizeEvent(e, sk), true, body)
  const req = (auth?: string, method = "GET") => new Request(url, { method, headers: auth ? { authorization: auth } : {} })
  assert.equal(await requireNostr(req(await tokenFor(allowed))), null)
  assert.equal((await requireNostr(req(await tokenFor(generateSecretKey()))))?.status, 403)
  assert.equal((await requireNostr(req()))?.status, 401)
  assert.equal((await requireNostr(req(await tokenFor(allowed, "http://evil.example/api/stream"))))?.status, 401)
  const body = { chain: "btc", hex: "00" }
  const posted = await tokenFor(allowed, url, "POST", body)
  assert.equal(await requireNostr(req(posted, "POST"), body), null)
  assert.equal((await requireNostr(req(posted, "POST"), { ...body, hex: "01" }))?.status, 401, "tampered body rejected")
  assert.equal((await requireNostr(req(await tokenFor(allowed, url, "POST"), "POST"), body))?.status, 401, "POST without payload tag rejected")

  console.log("all checks passed")
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
