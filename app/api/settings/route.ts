import { CHAIN_IDS } from "@/lib/chains"
import { authorizedJson, requireNostr } from "@/lib/server/auth"
import { config } from "@/lib/server/config"
import { getSettings, parseSettings, saveSettings } from "@/lib/server/settings"
import { currentSyncs, syncWatchers } from "@/lib/server/watcher"

/** GET → every chain's sources in effect: {chain: {electrum, mempool, custom}} (custom: set in Settings, not defaults). */
export async function GET(req: Request) {
  const denied = await requireNostr(req)
  if (denied) return denied
  const settings = await getSettings()
  return Response.json(
    Object.fromEntries(
      CHAIN_IDS.map((c) => [c, { ...config.sources(c, settings), custom: !!(settings.sources[c]?.electrum?.length || settings.sources[c]?.mempool?.length) }]),
    ),
  )
}

/** POST {settings patch} → full settings. A network or source change restarts syncs; gap changes rediscover. */
export async function POST(req: Request) {
  const body = await authorizedJson<Record<string, unknown>>(req)
  if (body instanceof Response) return body
  let patch
  try {
    patch = parseSettings(body)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
  const settings = await saveSettings(patch)
  await syncWatchers() // switches networks / restarts a chain whose sources changed
  if ("gapReceive" in patch || "gapChange" in patch) for (const s of currentSyncs()) s.kick()
  return Response.json(settings)
}
