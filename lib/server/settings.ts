import "server-only"
import { db } from "@/lib/server/db"
import { DEFAULT_SETTINGS, type FeePreset, type Settings } from "@/lib/wallet"

const listeners = new Set<(s: Settings) => void>()
export const onSettings = (l: (s: Settings) => void) => (listeners.add(l), () => void listeners.delete(l))

export async function getSettings(): Promise<Settings> {
  const rows = await db.setting.findMany()
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) }
}

const PRESETS: FeePreset[] = ["fastestFee", "halfHourFee", "hourFee", "economyFee", "minimumFee"]
const isGap = (v: unknown) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 200

/** Validates every key at the trust boundary; unknown keys or wrong types are rejected. */
export function parseSettings(input: unknown): Partial<Settings> {
  if (!input || typeof input !== "object") throw new Error("Invalid settings")
  const out: Partial<Settings> = {}
  for (const [k, v] of Object.entries(input)) {
    if ((k === "blake" || k === "sound" || k === "notifications" || k === "replayGuard") && typeof v === "boolean") out[k] = v
    else if (k === "feePreset" && PRESETS.includes(v as FeePreset)) out.feePreset = v as FeePreset
    else if ((k === "gapReceive" || k === "gapChange") && isGap(v)) out[k] = v as number
    else throw new Error(`Invalid setting: ${k}`)
  }
  return out
}

export async function saveSettings(patch: Partial<Settings>) {
  await db.$transaction(
    Object.entries(patch).map(([key, v]) =>
      db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } }),
    ),
  )
  const settings = await getSettings()
  for (const l of listeners) l(settings)
  return settings
}
