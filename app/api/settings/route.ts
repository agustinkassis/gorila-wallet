import { authorizedJson } from "@/lib/server/auth"
import { parseSettings, saveSettings } from "@/lib/server/settings"
import { currentWatchers, syncWatchers } from "@/lib/server/watcher"

/** POST {settings patch} → full settings. Gap-limit changes trigger discovery right away. */
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
  await syncWatchers() // starts/stops the Blake2b extension's watcher
  if ("gapReceive" in patch || "gapChange" in patch) for (const w of Object.values(currentWatchers())) w!.kick()
  return Response.json(settings)
}
