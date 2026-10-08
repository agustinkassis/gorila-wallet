"use client"

import { useEffect, useRef, useState } from "react"
import { DownloadIcon, PuzzleIcon, Trash2Icon, UploadIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useWallet } from "@/components/wallet-provider"
import { KIND, WatchOnlyBadge } from "@/components/wallet-switcher"
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
  const { settings, snapshots, chains } = useWallet()
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
            <p className="text-xs text-amber-600 dark:text-amber-400">Notifications are blocked for this site in your browser settings.</p>
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

      <WalletCard />
      <AccessCard />

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Servers</CardTitle>
          <CardDescription>From .env, or the defaults in .env.example.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {chains.map((c) => (
            <Info
              key={c}
              label={`${CHAINS[c].label}`}
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
  const { wallet } = useWallet()
  const file = useRef<HTMLInputElement>(null)
  const exportLabels = async () => {
    try {
      download(`${wallet?.name ?? "wallet"}-${chain}-labels.jsonl`, await api<string>(`/api/labels?wallet=${wallet?.id}&chain=${chain}`), "application/jsonl")
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message })
    }
  }
  const importLabels = async (f: File) => {
    try {
      const r = await api<{ imported: number; skipped: number }>("/api/labels/import", { walletId: wallet?.id, chain, jsonl: await f.text() })
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

/** The selected wallet: rename, public details, delete (software / watch-only wallets). */
function WalletCard() {
  const { wallet, wallets, selectWallet } = useWallet()
  const [name, setName] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  if (!wallet) return null
  const Kind = KIND[wallet.kind]

  const rename = async () => {
    if (name === null || !name.trim() || name.trim() === wallet.name) return setName(null)
    try {
      await api("/api/wallets", { action: "rename", id: wallet.id, name: name.trim() })
      setName(null)
    } catch (e) {
      toast.error("Couldn't rename", { description: (e as Error).message })
    }
  }
  const remove = async () => {
    try {
      await api("/api/wallets", { action: "delete", id: wallet.id })
      const next = wallets.find((w) => w.id !== wallet.id)
      if (next) selectWallet(next.id)
      toast.success(`Removed "${wallet.name}"`)
    } catch (e) {
      toast.error("Couldn't remove the wallet", { description: (e as Error).message })
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Kind.icon className="size-4" /> Wallet
          {wallet.watchOnly ? <WatchOnlyBadge /> : <span className="text-xs font-normal text-muted-foreground">{Kind.label}</span>}
        </CardTitle>
        <CardDescription>
          {wallet.kind === "seed"
            ? "Recovery words are stored encrypted with this wallet's password; you enter it to sign."
            : wallet.kind === "env"
              ? "From SEED_PHRASE in .env. The seed never leaves the server and is never written to the database."
              : "Public key only: balances and history, no signing."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
          <span className="shrink-0 text-muted-foreground sm:w-44">Name</span>
          {name === null ? (
            <button className="text-left hover:underline" onClick={() => setName(wallet.name)}>
              {wallet.name}
            </button>
          ) : (
            <Input
              autoFocus
              className="h-8 max-w-xs"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") setName(null)
              }}
            />
          )}
        </div>
        <Info label="Derivation path" value={wallet.path} />
        <Info label="Master fingerprint" value={wallet.fingerprint ? wallet.fingerprint.toString(16).padStart(8, "0") : "unknown"} />
        {wallet.passphrase && <Info label="BIP39 passphrase" value="yes (not stored in clear)" />}
        <Info label="Account xpub" value={wallet.xpub} />
        {wallet.kind !== "env" && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {confirming ? (
              <>
                <span className="text-xs text-rose-600 dark:text-rose-400">
                  Remove &quot;{wallet.name}&quot; and its labels from this app? {wallet.kind === "seed" && "Make sure you have its recovery words."}
                </span>
                <Button size="sm" variant="destructive" onClick={remove}>
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                <Trash2Icon /> Remove wallet
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Nostr keys allowed to open the app: ALLOWED_PUBKEYS (read-only) plus keys added here. */
function AccessCard() {
  const [access, setAccess] = useState<{ env: string[]; accounts: string[] } | null>(null)
  const [npub, setNpub] = useState("")
  useEffect(() => {
    let live = true
    api<{ env: string[]; accounts: string[] }>("/api/access")
      .then((a) => live && setAccess(a))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const change = async (action: "add" | "remove", pubkey: string) => {
    try {
      setAccess(await api("/api/access", { action, pubkey }))
      if (action === "add") setNpub("")
    } catch (e) {
      toast.error("Couldn't update access", { description: (e as Error).message })
    }
  }
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="size-4" /> Access
        </CardTitle>
        <CardDescription>Nostr keys that can log in. Every allowed key can open every wallet.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {!access ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            {access.env.map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <code className="min-w-0 truncate font-mono text-xs">{k}</code>
                <span className="shrink-0 text-xs text-muted-foreground">.env</span>
              </div>
            ))}
            {access.accounts.map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <code className="min-w-0 truncate font-mono text-xs">{k}</code>
                <Button size="sm" variant="ghost" onClick={() => change("remove", k)}>
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Input placeholder="npub1…" className="font-mono text-xs" value={npub} onChange={(e) => setNpub(e.target.value)} />
              <Button size="sm" disabled={!npub.trim()} onClick={() => change("add", npub.trim())}>
                Allow
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
