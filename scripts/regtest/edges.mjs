import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

export async function edges(h) {
  const chain = ['--chain', 'regtest']
  const balance = async () => (await h.cli(['balance', '--wallet', 'A', ...chain])).balances[0]
  const receive = await h.cli(['receive', '--wallet', 'A', ...chain])
  const before = await balance()
  const txids = [h.rpc('sendtoaddress', receive.address, 0.00001), h.rpc('sendtoaddress', receive.address, 0.00002)]
  for (const txid of txids) await h.indexedTx(txid)
  await h.check('multiple payments to one receive address accumulate exactly', async () => {
    const after = await balance()
    assert.equal(after.total, before.total + 3000)
    assert.equal(after.pending, 3000)
    const addresses = await h.cli(['addresses', '--wallet', 'A', ...chain])
    assert.equal(addresses.addresses.find(a => a.address === receive.address).chains[0].transactions, 2)
    return { txids, balance: after }
  })
  await h.check('used receive address advances cursor automatically', async () => {
    const next = await h.cli(['receive', '--wallet', 'A', ...chain])
    assert.equal(next.index, receive.index + 1)
    assert.notEqual(next.address, receive.address)
    return next
  })
  await h.mine()
  await h.check('multiple payment confirmations preserve total balance', async () => {
    const after = await balance()
    assert.equal(after.total, before.total + 3000)
    assert.equal(after.pending, 0)
    return after
  })
  const db = new Database(h.env.DATABASE_URL.slice(5))
  const aId = db.prepare('SELECT id FROM Wallet WHERE name=?').get('A').id
  try {
    await h.check('discovery extends beyond a persisted cursor past the gap limit', async () => {
      db.prepare('UPDATE ReceiveCursor SET "index"=40 WHERE walletId=? AND family=?').run(aId, 'regtest')
      const next = await h.cli(['receive', '--wallet', 'A', ...chain, '--next'])
      assert.equal(next.index, 41)
      const descriptor = await h.cli(['wallet', 'descriptor', '--wallet', 'A', ...chain])
      assert.equal(next.address, h.rpc('deriveaddresses', descriptor.receive, [41, 41])[0])
      const old = await balance()
      const txid = h.rpc('sendtoaddress', next.address, 0.00003)
      await h.indexedTx(txid)
      await h.mine()
      assert.equal((await balance()).total, old.total + 3000)
      const addresses = await h.cli(['addresses', '--wallet', 'A', ...chain])
      assert.ok(addresses.addresses.some(a => a.index > 41 && a.change === 0))
      return { txid, index: next.index, address: next.address }
    })
    const watchId = randomUUID()
    db.prepare('INSERT INTO Wallet(id,name,kind,passphrase,createdAt) VALUES(?,?,?,?,?)').run(watchId, 'watch-regtest', 'watch', 0, Date.now())
    db.prepare('INSERT INTO WalletAccount(walletId,family,xpub,path,fingerprint) SELECT ?,family,xpub,path,fingerprint FROM WalletAccount WHERE walletId=? AND family=?').run(watchId, aId, 'regtest')
    db.prepare('INSERT INTO ReceiveCursor(walletId,family,"index") SELECT ?,family,"index" FROM ReceiveCursor WHERE walletId=? AND family=?').run(watchId, aId, 'regtest')
    await h.check('watch-only regtest wallet without seed synchronizes real funds', async () => {
      const watched = await h.cli(['balance', '--wallet', watchId, ...chain])
      assert.equal(watched.balances[0].total, (await balance()).total)
      const address = await h.cli(['receive', '--wallet', watchId, ...chain])
      assert.ok(address.address.startsWith('bcrt1'))
      return watched
    })
    await h.check('watch-only export and signing reject without broadcast', async () => {
      const mempool = h.rpc('getrawmempool')
      assert.match(await h.cli(['wallet', 'export-seed', '--wallet', watchId], false), /Watch-only/)
      const error = await h.cli(['send', '--wallet', watchId, ...chain, '--to', receive.address, '--amount-sats', '1000', '--fee-rate', '2', '--yes'], false)
      assert.match(error, /Watch-only/)
      assert.deepEqual(h.rpc('getrawmempool'), mempool)
      return { mempoolUnchanged: true }
    })
  } finally { db.close() }
  await h.check('saved regtest sources override conflicting environment', async () => {
    h.env.REGTEST_ELECTRUM = 'tcp://127.0.0.1:1'
    h.env.MEMPOOL_REGTEST_URL = 'http://127.0.0.1:1'
    try {
      const shown = await h.cli(['config', 'show'])
      const source = shown.chains.find(c => c.chain === 'regtest')
      assert.equal(source.electrum.source, 'Settings')
      assert.deepEqual(source.electrum.urls, [h.electrum])
      assert.deepEqual(source.mempool.urls, [h.api])
      assert.ok((await balance()).total > 0)
      return source
    } finally { delete h.env.REGTEST_ELECTRUM; delete h.env.MEMPOOL_REGTEST_URL }
  })
  await h.check('mainnet recipient is rejected by regtest before broadcast', async () => {
    const descriptor = await h.cli(['wallet', 'descriptor', '--wallet', 'A'])
    const { HDKey } = await import('@scure/bip32')
    const { p2wpkh } = await import('@scure/btc-signer')
    const account = HDKey.fromExtendedKey(descriptor.xpub)
    const address = p2wpkh(account.deriveChild(0).deriveChild(0).publicKey).address
    const mempool = h.rpc('getrawmempool')
    const error = await h.cli(['send', '--wallet', 'A', ...chain, '--to', address, '--amount-sats', '1000', '--fee-rate', '2', '--yes'], false)
    assert.match(error, /Invalid Regtest address/)
    assert.deepEqual(h.rpc('getrawmempool'), mempool)
    return { mempoolUnchanged: true }
  })
  await h.check('UTF-8 message sends to a Core wallet and confirms', async () => {
    const destination = h.rpc('getnewaddress')
    const message = 'pago local: café ₿'
    const sent = await h.cli(['send', '--wallet', 'A', ...chain, '--to', destination, '--amount-sats', '10000', '--fee-rate', '3', '--message', message, '--yes'])
    const node = h.nodeTx(sent.txid)
    assert.ok(node.vout.some(v => v.scriptPubKey.hex.includes(Buffer.from(message).toString('hex'))))
    await h.mine()
    assert.ok(h.nodeTx(sent.txid).confirmations > 0)
    assert.ok(h.rpc('gettransaction', sent.txid).details.some(d => d.category === 'receive' && d.address === destination))
    return { txid: sent.txid, confirmations: h.nodeTx(sent.txid).confirmations }
  })
}
