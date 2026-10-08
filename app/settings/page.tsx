"use client"

import { useRef, useState } from "react"
import { DownloadIcon, PuzzleIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useWallet } from "@/components/wallet-provider"
import { api, download } from "@/lib/api"
import { canNotify, requestNotifications } from "@/lib/notify"
import { CHAINS, type Chain, type FeePreset, type Settings } from "@/lib/wallet"
import { cn } from "@/lib/utils"

const PRESETS: { key: FeePreset; label: string }[] = [
  { key: "fastestFee", label: "Fastest" },
  { key: "halfHourFee", label: "30 min" },
  { key: "hourFee", label: "1 hour" },
  { key: "economyFee", label: "Economy" },
]

export default function SettingsPage() {
  const { settings, snapshots, xpub, path, fingerprint, chains } = useWallet()
  const save = async (patch: Partial<Settings>) => {
    try {
      await api("/api/settings", patch)
    } catch (e) {
      toast.error("Couldn't save setting", { description: (e as Error).message })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PuzzleIcon className="size-4" /> Extensions
          </CardTitle>
          <CardDescription>Optional chains and features. Turning one off stops its sync; its cached data stays for when you turn it back on.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={cn("size-2 rounded-full", CHAINS.xbt.bg)} />
                Blake2b (XBT)
              </span>
              <span className="text-xs text-muted-foreground">
                Track and spend the Bitcoin BLAKE2b fork with the same keys. Blake sends are replay-protected with SIGHASH_UNIFIED, and Bitcoin sends get
                the optional Bitcoin-only OP_RETURN guard.
              </span>
            </span>
            <Switch checked={settings.blake} onCheckedChange={(blake) => save({ blake })} aria-label="Blake2b extension" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>How incoming payments are announced.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Toggle label="Sound on incoming payments" checked={settings.sound} onChange={(sound) => save({ sound })} />
          <Toggle
            label="System notifications when the tab is in the background"
            checked={settings.notifications}
            onChange={(notifications) => {
              if (notifications) requestNotifications()
              void save({ notifications })
            }}
          />
          {canNotify() && typeof Notification !== "undefined" && Notification.permission === "denied" && (
            <p className="text-xs text-amber-400">Notifications are blocked for this site in your browser settings.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sending</CardTitle>
          <CardDescription>Defaults for new payments.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-sm">Default fee</Label>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => save({ feePreset: p.key })}
                  className={cn("rounded-lg border px-2 py-1.5 text-xs", settings.feePreset === p.key ? "border-primary bg-secondary" : "hover:bg-muted/50")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {settings.blake && (
            <Toggle
              label="Bitcoin-only OP_RETURN replay guard on by default"
              checked={settings.replayGuard}
              onChange={(replayGuard) => save({ replayGuard })}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Address discovery</CardTitle>
          <CardDescription>Gap limit: how many unused addresses to watch past the last used one (Electrum: 20 / 10).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <GapInput label="Receive" value={settings.gapReceive} onSave={(gapReceive) => save({ gapReceive })} />
          <GapInput label="Change" value={settings.gapChange} onSave={(gapChange) => save({ gapChange })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labels (BIP-329)</CardTitle>
          <CardDescription>Export or import labels and frozen coins. Works with Sparrow, Nunchuk, BlueWallet and others.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {chains.map((chain) => (
            <LabelsRow key={chain} chain={chain} />
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
          <CardDescription>Public data only. The seed never leaves the backend.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Info label="Derivation path" value={path ?? "—"} />
          <Info label="Master fingerprint" value={fingerprint !== undefined ? fingerprint.toString(16).padStart(8, "0") : "—"} />
          <Info label="Account xpub" value={xpub ?? "—"} />
          {chains.map((c) => (
            <Info
              key={c}
              label={`${CHAINS[c].label} servers`}
              value={`Electrum ${snapshots[c]?.server ?? "connecting…"} · mempool ${snapshots[c]?.explorer ?? "—"}`}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function GapInput({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const commit = () => {
    const n = Number(draft)
    if (Number.isInteger(n) && n >= 5 && n <= 200 && n !== value) onSave(n)
    else setDraft(String(value))
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </div>
  )
}

function LabelsRow({ chain }: { chain: Chain }) {
  const file = useRef<HTMLInputElement>(null)
  const exportLabels = async () => {
    try {
      download(`gorilla-wallet-${chain}-labels.jsonl`, await api<string>(`/api/labels?chain=${chain}`), "application/jsonl")
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message })
    }
  }
  const importLabels = async (f: File) => {
    try {
      const r = await api<{ imported: number; skipped: number }>("/api/labels/import", { chain, jsonl: await f.text() })
      toast.success(`Imported ${r.imported} labels`, { description: r.skipped ? `${r.skipped} skipped` : undefined })
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message })
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">{CHAINS[chain].label}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={exportLabels}>
          <DownloadIcon /> Export
        </Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          <UploadIcon /> Import
        </Button>
        <input
          ref={file}
          type="file"
          accept=".jsonl,.json,application/jsonl,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importLabels(f)
            e.target.value = ""
          }}
        />
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <span className="shrink-0 text-muted-foreground sm:w-44">{label}</span>
      <code className="min-w-0 font-mono text-xs break-all">{value}</code>
    </div>
  )
}
