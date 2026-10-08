"use client"

import { useEffect, useRef, useState } from "react"
import jsQR from "jsqr"
import { joinQRs } from "bbqr"
import { CameraOffIcon } from "lucide-react"

export type Scanned = Uint8Array | string

/**
 * Camera QR reader for what signers hand back: animated UR (crypto-psbt), BBQr, or a single QR
 * (base64 PSBT / hex tx). Multi-part codes are assembled across frames; resolves once complete.
 */
export function QrScanner({ onResult }: { onResult: (data: Scanned) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(() =>
    typeof navigator !== "undefined" && !navigator.mediaDevices ? "Camera not available in this browser. Paste or upload instead." : null,
  )
  const [progress, setProgress] = useState<string | null>(null)
  const done = useRef(onResult)
  useEffect(() => {
    done.current = onResult
  }, [onResult])

  useEffect(() => {
    let stream: MediaStream | undefined
    let raf = 0
    let stopped = false
    let ur: { receivePart(p: string): boolean; isComplete(): boolean; isSuccess(): boolean; estimatedPercentComplete(): number; resultUR(): { type: string; decodeCBOR(): Uint8Array } } | null = null
    const bbqr = new Map<number, string>()
    let bbqrTotal = 0
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!

    const finish = (data: Scanned) => {
      stopped = true
      done.current(data)
    }

    const handle = async (text: string) => {
      if (/^ur:/i.test(text)) {
        if (!ur) {
          const { Buffer } = await import("buffer")
          ;(globalThis as { Buffer?: unknown }).Buffer ??= Buffer // bc-ur expects Node's Buffer
          const { URDecoder } = await import("@ngraveio/bc-ur")
          ur = new URDecoder()
        }
        ur.receivePart(text.toLowerCase())
        setProgress(`UR ${Math.round(ur.estimatedPercentComplete() * 100)}%`)
        if (ur.isComplete() && ur.isSuccess()) finish(new Uint8Array(ur.resultUR().decodeCBOR()))
      } else if (text.startsWith("B$") && text.length > 8) {
        bbqrTotal = parseInt(text.slice(4, 6), 36)
        bbqr.set(parseInt(text.slice(6, 8), 36), text)
        setProgress(`BBQr ${bbqr.size}/${bbqrTotal}`)
        if (bbqr.size === bbqrTotal) finish(joinQRs([...bbqr.values()]).raw)
      } else finish(text)
    }

    const tick = async () => {
      if (stopped) return
      const v = video.current
      if (v && v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        ctx.drawImage(v, 0, 0)
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })
        if (code?.data) {
          try {
            await handle(code.data)
          } catch {
            setProgress("Unreadable frame, keep scanning…")
          }
        }
      }
      if (!stopped) raf = window.setTimeout(() => requestAnimationFrame(tick), 80)
    }

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        video.current!.srcObject = s
        void video.current!.play()
        void tick()
      })
      .catch(() => setError("Camera not available. Allow camera access, or paste / upload instead."))

    return () => {
      stopped = true
      clearTimeout(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (error)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        <CameraOffIcon className="size-6" />
        {error}
      </div>
    )
  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={video} muted playsInline className="aspect-square w-full object-cover" />
      <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
        {progress ?? "Point at the signed transaction QR"}
      </span>
    </div>
  )
}
