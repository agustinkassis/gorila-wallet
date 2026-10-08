import "server-only"
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto"

// scrypt N=2^16 (≈64 MiB, ~0.2 s): slow enough to make guessing a wallet password from a stolen DB expensive.
const N = 2 ** 16
const r = 8
const p = 1
const MAXMEM = 256 * 1024 * 1024

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong wallet password")
  }
}

const kdf = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  )

/** Encrypt with a password: scrypt-derived key, AES-256-GCM. Returns a self-describing JSON string. */
export async function seal(plaintext: string, password: string) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", await kdf(password, salt), iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const b64 = (b: Buffer) => b.toString("base64")
  return JSON.stringify({ v: 1, kdf: "scrypt", N, r, p, salt: b64(salt), iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) })
}

/** Decrypt; a wrong password (or tampered data) fails GCM authentication → WrongPasswordError. */
export async function unseal(sealed: string, password: string) {
  const s = JSON.parse(sealed) as { salt: string; iv: string; tag: string; ct: string }
  const buf = (v: string) => Buffer.from(v, "base64")
  const decipher = createDecipheriv("aes-256-gcm", await kdf(password, buf(s.salt)), buf(s.iv))
  decipher.setAuthTag(buf(s.tag))
  try {
    return Buffer.concat([decipher.update(buf(s.ct)), decipher.final()]).toString("utf8")
  } catch {
    throw new WrongPasswordError()
  }
}
