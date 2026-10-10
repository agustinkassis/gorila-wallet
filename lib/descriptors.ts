import { displayXpub, type Account } from "@/lib/wallet"
import type { Family } from "@/lib/chains"

const INPUT = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ "
const OUTPUT = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const GENERATORS = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn] as const

/** BIP-380 descriptor checksum (https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki). */
export function descriptorChecksum(body: string): string {
  let checksum = 1n
  const feed = (value: number) => {
    const top = checksum >> 35n
    checksum = ((checksum & 0x7ffffffffn) << 5n) ^ BigInt(value)
    GENERATORS.forEach((generator, i) => { if ((top >> BigInt(i)) & 1n) checksum ^= generator })
  }
  let group = 0
  let count = 0
  for (const char of body) {
    const value = INPUT.indexOf(char)
    if (value < 0) throw new RangeError("Invalid descriptor character")
    feed(value & 31)
    group = group * 3 + (value >> 5)
    if (++count === 3) { feed(group); group = 0; count = 0 }
  }
  if (count) feed(group)
  for (let i = 0; i < 8; i++) feed(0)
  checksum ^= 1n
  return Array.from({ length: 8 }, (_, i) => OUTPUT[Number((checksum >> BigInt(5 * (7 - i))) & 31n)]).join("")
}

export function accountDescriptors(account: Account, family: Family) {
  const origin = account.fingerprint.toString(16).padStart(8, "0") + account.path.slice(1)
  const branch = (change: 0 | 1) => {
    const body = `wpkh([${origin}]${displayXpub(account.xpub, family)}/${change}/*)`
    return `${body}#${descriptorChecksum(body)}`
  }
  return { receive: branch(0), change: branch(1) }
}
