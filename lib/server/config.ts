import "server-only"

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean)

/** Runtime configuration, read from the environment on access. Every default mirrors .env.example, so the app runs with an empty .env. */
export const config = {
  /** optional: a default wallet from the environment (its seed is never written to the DB) */
  get seedPhrase() {
    return process.env.SEED_PHRASE?.trim() || null
  },
  get derivationPath() {
    return process.env.DERIVATION_PATH?.trim() || "m/84'/0'/0'"
  },
  /** optional: npub/hex allowlist; without it the first Nostr login claims the app */
  get allowedPubkeys() {
    return list(process.env.ALLOWED_PUBKEYS ?? "")
  },
  get electrum() {
    return {
      btc: list(process.env.BTC_ELECTRUM || "ssl://electrum.blockstream.info:50002,ssl://electrum.emzy.de:50002,ssl://bitcoin.lu.ke:50002"),
      xbt: list(process.env.XBT_ELECTRUM || "tcp://fulcrum.kilombino.com:17717,tcp://electrum.marcanotrades.com:4142"),
    }
  },
  get mempool() {
    return {
      btc: process.env.MEMPOOL_BTC_URL || "https://mempool.space",
      xbt: process.env.MEMPOOL_XBT_URL || "https://mempool.kilombino.com",
    }
  },
}
