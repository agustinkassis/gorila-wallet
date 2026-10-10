import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

export async function scenarios(h) {
  const { cli, check, rpc } = h
  const password = h.secret('password.txt', 'regtest-password')
  const wrong = h.secret('wrong.txt', 'wrong-password')
  const passphrase = h.secret('passphrase.txt', 'regtest separate passphrase')
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const seed = h.secret('seed.txt', mnemonic)
  const chain = ['--chain', 'regtest']
  const wallet = (command, name, extra = []) => cli([command, '--wallet', name, ...chain, ...extra])
  const balance = name => wallet('balance', name)
  const sendArgs = (from, to, amount, extra = [], rate = 2) => ['send', '--wallet', from, ...chain, '--to', to, '--amount-sats', String(amount), '--fee-rate', String(rate), '--yes', ...extra]
  const send = async (from, to, amount, extra = [], rate = 2) => {
    const result = await cli(sendArgs(from, to, amount, extra, rate))
    await h.indexedTx(result.txid)
    const tx = h.nodeTx(result.txid)
    assert.equal(tx.txid, result.txid)
    assert.ok(rpc('getrawmempool').includes(result.txid))
    assert.equal(tx.vsize, result.vsize)
    assert.equal(Math.round(tx.vout.find(output => output.scriptPubKey.address === to).value * 1e8), amount)
    assert.ok(tx.vin.every(input => input.txinwitness?.[0].endsWith('01')))
    assert.equal(Math.round(tx.vout.reduce((sum, output) => sum + output.value, 0) * 1e8) + result.fee, result.review.inputs.reduce((sum, input) => sum + input.value, 0))
    return { ...result, node: tx }
  }
  const fund = async (address, amount) => { const txid = rpc('sendtoaddress', address, amount); await h.indexedTx(txid); return txid }
  const reject = async (name, args, pattern) => check(name, async () => {
    const before = rpc('getrawmempool').sort()
    const error = await cli(args, false)
    if (pattern) assert.match(error, pattern)
    assert.deepEqual(rpc('getrawmempool').sort(), before)
    return { error, mempoolUnchanged: true }
  })
  await check('import BIP39 wallet A', async () => { const r = await cli(['wallet', 'import', '--name', 'A', '--seed-file', seed]); assert.equal(r.wallet.kind, 'seed'); return r.wallet })
  const b = await check('create encrypted 24-word wallet B with BIP39 passphrase', async () => { const r = await cli(['wallet', 'create', '--name', 'B', '--password-file', password, '--passphrase-file', passphrase]); assert.equal(r.mnemonic.split(' ').length, 24); assert.equal(r.wallet.needsPassword, true); return r })
  await check('create 12-word wallet C', async () => { const r = await cli(['wallet', 'create', '--name', 'C', '--words', '12']); assert.equal(r.mnemonic.split(' ').length, 12); return r.wallet })
  await check('create independent wallet D', async () => { const r = await cli(['wallet', 'create', '--name', 'D']); assert.ok(r.wallet.id); return r.wallet })
  await check('list all four wallets', async () => { const r = await cli(['wallet', 'list']); assert.equal(r.wallets.length, 4); return r })
  await check('export imported mnemonic', async () => { const r = await cli(['wallet', 'export-seed', '--wallet', 'A']); assert.equal(r.mnemonic, mnemonic); return { matches: true } })
  await check('export encrypted mnemonic and passphrase', async () => { const r = await cli(['wallet', 'export-seed', '--wallet', 'B', '--password-file', password, '--include-passphrase']); assert.equal(r.mnemonic, b.mnemonic); assert.equal(r.passphrase, 'regtest separate passphrase'); return { matches: true } })
  await check('export omits passphrase by default', async () => { const r = await cli(['wallet', 'export-seed', '--wallet', 'B', '--password-file', password]); assert.equal(r.passphrase, undefined); return { omitted: true } })
  await reject('wrong password rejects seed export', ['wallet', 'export-seed', '--wallet', 'B', '--password-file', wrong])
  await reject('noninteractive encrypted export requires secret', ['wallet', 'export-seed', '--wallet', 'B'])
  await reject('ambiguous wallet selection rejects', ['balance', ...chain])
  await reject('unknown wallet rejects', ['balance', ...chain, '--wallet', 'absent'])
  await reject('invalid word count rejects', ['wallet', 'create', '--name', 'invalid', '--words', '15'])
  await reject('invalid mnemonic rejects', ['wallet', 'import', '--name', 'invalid', '--seed-file', h.secret('invalid-seed.txt', 'abandon '.repeat(12))])
  const descriptor = await check('Core validates regtest receive descriptor', async () => { const r = await cli(['wallet', 'descriptor', '--wallet', 'A', ...chain]); const core = rpc('getdescriptorinfo', r.receive); assert.equal(core.checksum, r.receive.split('#')[1]); assert.equal(r.family, 'regtest'); return r })
  await check('Core validates change descriptor', async () => { const r = rpc('getdescriptorinfo', descriptor.change); assert.equal(r.checksum, descriptor.change.split('#')[1]); return r })
  const aReceive = await check('receive address agrees with Core descriptor derivation', async () => { const r = await wallet('receive', 'A'); assert.equal(r.address, rpc('deriveaddresses', descriptor.receive, [r.index, r.index])[0]); assert.ok(r.address.startsWith('bcrt1')); return r })
  await check('receive cursor stable without next', async () => { const r = await wallet('receive', 'A'); assert.equal(r.address, aReceive.address); return r })
  await check('receive next advances cursor with label', async () => { const r = await wallet('receive', 'A', ['--next', '--label', 'round-trip']); assert.equal(r.index, aReceive.index + 1); return r })
  await check('concurrent receive next allocates distinct indices', async () => { const r = await Promise.all([wallet('receive', 'A', ['--next']), wallet('receive', 'A', ['--next'])]); assert.deepEqual(r.map(x => x.index).sort(), [2, 3]); return r })
  await check('address label persists', async () => { await cli(['address', 'label', aReceive.address, 'funding', '--wallet', 'A', ...chain]); const r = await wallet('addresses', 'A'); assert.equal(r.addresses.find(a => a.address === aReceive.address).label, 'funding'); return r })
  const bReceive = await check('encrypted wallet derives regtest receive address', async () => { const r = await wallet('receive', 'B', ['--password-file', password]); assert.ok(r.address.startsWith('bcrt1')); assert.notEqual(r.address, aReceive.address); return r })
  await check('all-wallet balance includes four empty regtest wallets', async () => { const r = await cli(['balance', ...chain, '--all-wallets']); assert.equal(r.balances.length, 4); assert.ok(r.balances.every(b => b.total === 0)); return r })
  const funding = await fund(aReceive.address, 0.05)
  await check('pending funding balance is exact', async () => { const r = await balance('A'); assert.equal(r.balances[0].pending, 5000000); assert.equal(r.balances[0].confirmed, 0); return r })
  await check('pending funding transaction status', async () => { const status = await cli(['tx-status', funding, '--wallet', 'A', ...chain]); assert.equal(status.confirmed, false); return status })
  await h.mine()
  await check('confirmed funding balance is exact', async () => { const r = await balance('A'); assert.equal(r.balances[0].confirmed, 5000000); assert.equal(r.balances[0].pending, 0); return r })
  await check('transaction list includes confirmed funding', async () => { const r = await wallet('transactions', 'A'); assert.equal(r.transactions.find(t => t.txid === funding).confirmations, 1); return r })
  await check('confirmed transaction status agrees with Core', async () => { const r = await cli(['tx-status', funding, '--wallet', 'A', ...chain]); assert.equal(r.confirmations, h.nodeTx(funding).confirmations); return r })
  await check('external transaction status from real Esplora', async () => { const txid = rpc('getblock', rpc('getblockhash', 1)).tx[0]; const r = await cli(['tx-status', txid, '--wallet', 'A', ...chain]); assert.equal(r.found, true); assert.equal(r.confirmations, h.nodeTx(txid).confirmations); return r })
  await check('missing transaction returns found false', async () => { const r = await cli(['tx-status', 'ee'.repeat(32), '--wallet', 'A', ...chain]); assert.equal(r.found, false); return r })
  const base = sendArgs('A', bReceive.address, 10000)
  await reject('send without confirmation leaves mempool unchanged', base.filter(a => a !== '--yes'))
  for (const [name, option, value] of [['zero amount', '--amount-sats', '0'], ['negative amount', '--amount-sats', '-1'], ['fractional amount', '--amount-sats', '1.5'], ['insufficient funds', '--amount-sats', '999999999'], ['fee below one', '--fee-rate', '0.5'], ['excessive fee', '--fee-rate', '1001'], ['invalid recipient', '--to', 'invalid']]) {
    const args = [...base]; args[args.indexOf(option) + 1] = value
    await reject(`${name} rejects without broadcast`, args)
  }
  const first = await check('HTTP send uses one input and creates change', async () => { const r = await send('A', bReceive.address, 1000000, ['--message', 'real regtest']); assert.equal(r.node.vin.length, 1); assert.ok(r.review.outputs.some(o => o.kind === 'change')); assert.ok(r.node.vout.some(o => o.scriptPubKey.hex.startsWith('6a') && o.scriptPubKey.hex.length >= 168)); return r })
  await check('recipient sees pending sent funds', async () => { const r = await balance('B'); assert.equal(r.balances[0].pending, 1000000); return r })
  const block = await h.mine()
  await check('recipient sees confirmed sent funds', async () => { const r = await balance('B'); assert.equal(r.balances[0].confirmed, 1000000); return r })
  await reject('wrong encrypted signing password leaves mempool unchanged', sendArgs('B', aReceive.address, 1000, ['--password-file', wrong]), /password/i)
  rpc('invalidateblock', block); await h.rebuildIndexer()
  await check('reorg and rebuilt index roll confirmed transaction back to pending', async () => { const r = await cli(['tx-status', first.txid, '--wallet', 'B', ...chain]); assert.equal(r.confirmed, false); assert.equal(r.confirmations, 0); const b = await balance('B'); assert.equal(b.balances[0].pending, 1000000); assert.equal(b.balances[0].confirmed, 0); return r })
  rpc('reconsiderblock', block); await h.indexed()
  await check('reconsider restores confirmation', async () => { const r = await cli(['tx-status', first.txid, '--wallet', 'B', ...chain]); assert.equal(r.confirmed, true); assert.equal(r.confirmations, 1); return r })
  await check('encrypted B sends back and Core accepts signature', async () => { const r = await send('B', aReceive.address, 10000, ['--password-file', password]); await h.mine(); assert.ok(h.nodeTx(r.txid).confirmations > 0); return r })
  await check('Electrum fallback broadcasts during HTTP outage', async () => { h.faults.httpUnavailable = true; let r; try { r = await cli(sendArgs('A', bReceive.address, 10000)) } finally { h.faults.httpUnavailable = false } await h.indexedTx(r.txid); assert.equal(h.nodeTx(r.txid).txid, r.txid); await h.mine(); return r })
  await check('dead first Electrum endpoint fails over to real server', async () => { await cli(['config', 'set', ...chain, '--electrum', 'tcp://127.0.0.1:1', '--electrum', h.electrum]); const r = await balance('A'); assert.ok(r.balances[0].confirmed > 0); return r })
  await cli(['config', 'set', ...chain, '--electrum', 'tcp://127.0.0.1:1'])
  await reject('unavailable Electrum terminates within CLI timeout', ['balance', '--wallet', 'A', ...chain, '--timeout', '1'])
  await check('restored Electrum recovers synchronization', async () => { await cli(['config', 'set', ...chain, '--electrum', h.electrum]); const r = await balance('A'); assert.ok(r.balances[0].total > 0); return r })
  const c = await wallet('receive', 'C')
  await fund(c.address, 0.0001); await fund(c.address, 0.0001); await h.mine()
  await check('multiple-input send consumes both small UTXOs', async () => { const r = await send('C', aReceive.address, 15000); assert.equal(r.node.vin.length, 2); await h.mine(); return r })
  const d = await wallet('receive', 'D')
  await fund(d.address, 0.0001); await h.mine()
  await check('near-total send omits dust change', async () => { const r = await send('D', aReceive.address, 9500); assert.equal(r.review.outputs.some(o => o.kind === 'change'), false); await h.mine(); return r })
  await balance('A')
  const db = new Database(h.env.DATABASE_URL.slice(5))
  try {
    const aId = db.prepare('SELECT id FROM Wallet WHERE name=?').get('A').id
    const utxos = db.prepare('SELECT txid,vout FROM Utxo WHERE walletId=? AND chain=?').all(aId, 'regtest')
    for (const u of utxos) db.prepare('INSERT OR REPLACE INTO Label(walletId,chain,type,ref,spendable) VALUES(?,?,?,?,?)').run(aId, 'regtest', 'output', `${u.txid}:${u.vout}`, 0)
    await reject('all frozen UTXOs cannot be spent', sendArgs('A', bReceive.address, 10000))
    db.prepare('DELETE FROM Label WHERE walletId=? AND type=?').run(aId, 'output')
    const dId = db.prepare('SELECT id FROM Wallet WHERE name=?').get('D').id
    db.prepare('UPDATE Wallet SET kind=? WHERE id=?').run('watch', dId)
    await reject('watch-only wallet cannot sign', sendArgs('D', aReceive.address, 1000))
    db.prepare('UPDATE Wallet SET kind=? WHERE id=?').run('seed', dId)
  } finally { db.close() }
  h.faults.feesUnavailable = true
  try {
    await reject('HTTP and Electrum fee source outages require explicit fee rate', ['send', '--wallet', 'A', ...chain, '--to', bReceive.address, '--amount-sats', '10000', '--yes', '--timeout', '1'], /supply --fee-rate/)
  } finally { h.faults.feesUnavailable = false }
  await check('config show exposes isolated regtest sources', async () => { const r = await cli(['config', 'show']); const source = r.chains.find(c => c.chain === 'regtest'); assert.deepEqual(source.electrum.urls, [h.electrum]); return source })
  for (let round = 1; round <= 20; round++) {
    await check(`round ${round}: A to B to A both confirmed`, async () => {
      const beforeA = (await balance('A')).balances[0].total
      const beforeB = (await balance('B')).balances[0].total
      const amount = 20000 + ((Math.imul(round, 1103515245) + 12345) >>> 0) % 50000
      const returned = Math.floor(amount / 2)
      const outbound = await send('A', bReceive.address, amount, [], 2 + round % 5)
      await h.mine()
      const inbound = await send('B', aReceive.address, returned, ['--password-file', password], 1 + round % 3)
      await h.mine()
      const statuses = await Promise.all([cli(['tx-status', outbound.txid, '--wallet', 'A', ...chain]), cli(['tx-status', inbound.txid, '--wallet', 'B', ...chain])])
      assert.ok(statuses.every(status => status.confirmed && status.confirmations > 0))
      const node = [h.nodeTx(outbound.txid), h.nodeTx(inbound.txid)]
      assert.ok(node.every(tx => tx.confirmations > 0))
      const afterA = (await balance('A')).balances[0].total
      const afterB = (await balance('B')).balances[0].total
      assert.equal(afterA, beforeA - amount - outbound.fee + returned)
      assert.equal(afterB, beforeB + amount - returned - inbound.fee)
      return { round, amount, returned, beforeA, beforeB, afterA, afterB, txids: [outbound.txid, inbound.txid], statuses, node }
    })
  }
  assert.ok(h.cases.filter(c => !c.name.startsWith('round ')).length >= 50)
}
