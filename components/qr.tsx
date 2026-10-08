"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { splitQRs } from "bbqr"
import { base64 } from "@scure/base"
import { CopyIcon, DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copy } from "@/components/site-header"
import { download } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Static QR rendered as SVG. */
export function QrImage({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("")
  useEffect(() => {
    let live = true
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "L", margin: 2 })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(""))
    return () => {
      live = false
    }
  }, [value])
  return (
    <div
      className={cn("aspect-square w-full max-w-72 overflow-hidden rounded-xl bg-white p-1 [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Cycles through QR frames (multi-part UR / BBQr). */
export function AnimatedQr({ frames, fps = 4, className }: { frames: string[]; fps?: number; className?: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (frames.length < 2) return
    const t = setInterval(() => setI((n) => (n + 1) % frames.length), 1000 / fps)
    return () => clearInterval(t)
  }, [frames, fps])
  const frame = frames[i % frames.length] ?? ""
  return (
    <div className="flex flex-col items-center gap-2">
      <QrImage value={frame} className={className} />
      {frames.length > 1 && <span className="font-mono text-xs text-muted-foreground">animated · {frames.length} frames</span>}
    </div>
  )
}

/** UR "crypto-psbt" frames (Blockchain Commons). Fountain-coded: 3× the fragment count so scanners can recover drops. */
async function urFrames(psbt: Uint8Array) {
  const { Buffer } = await import("buffer")
  ;(globalThis as { Buffer?: unknown }).Buffer ??= Buffer // bc-ur expects Node's Buffer
  const { UR, UREncoder } = await import("@ngraveio/bc-ur")
  const ur = new UR(UR.fromBuffer(Buffer.from(psbt)).cbor, "crypto-psbt")
  const encoder = new UREncoder(ur, 250)
  const count = encoder.fragmentsLength === 1 ? 1 : encoder.fragmentsLength * 3
  return Array.from({ length: count }, () => encoder.nextPart().toUpperCase())
}

type PsbtFormat = "ur" | "bbqr" | "base64"
const FORMATS: { id: PsbtFormat; label: string; hint: string }[] = [
  { id: "ur", label: "UR", hint: "Sparrow, Keystone, Passport, BlueWallet, Nunchuk, Jade, SeedSigner" },
  { id: "bbqr", label: "BBQr", hint: "Coldcard Q, Sparrow" },
  { id: "base64", label: "Base64", hint: "Electrum, Sparrow (paste)" },
]

/** Unsigned PSBT as QR in wallet-standard encodings, plus copy / .psbt download. */
export function PsbtQr({ psbt, filename }: { psbt: Uint8Array; filename: string }) {
  const [format, setFormat] = useState<PsbtFormat>("ur")
  const [frames, setFrames] = useState<string[]>([])
  const b64 = base64.encode(psbt)

  useEffect(() => {
    let live = true
    const make = async () => {
      if (format === "ur") return urFrames(psbt)
      if (format === "bbqr") return splitQRs(psbt, "P", { encoding: "Z", maxVersion: 20 }).parts
      return [b64]
    }
    make()
      .then((f) => live && setFrames(f))
      .catch(() => live && setFrames([]))
    return () => {
      live = false
    }
  }, [format, psbt, b64])

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="QR format">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={format === f.id}
            onClick={() => setFormat(f.id)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium", format === f.id ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}
          >
            {f.label}
          </button>
        ))}
      </div>
      {frames.length ? <AnimatedQr frames={frames} /> : <div className="aspect-square w-full max-w-72 animate-pulse rounded-xl bg-muted" />}
      <p className="text-center text-xs text-muted-foreground">{FORMATS.find((f) => f.id === format)!.hint}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => copy(b64, "PSBT copied (base64)")}>
          <CopyIcon /> Copy base64
        </Button>
        <Button variant="outline" size="sm" onClick={() => download(filename, psbt.slice().buffer)}>
          <DownloadIcon /> Download .psbt
        </Button>
      </div>
    </div>
  )
}
