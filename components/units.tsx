"use client"

import { useSyncExternalStore } from "react"
import { SatSymbol } from "@/components/sat-symbol"
import { Switch } from "@/components/ui/switch"
import { CHAINS, type Chain, type Unit } from "@/lib/wallet"
import { cn } from "@/lib/utils"

// Display unit, per browser in localStorage (like the theme). Server render is BTC; the switch updates every tab.
const KEY = "gorilla-wallet:unit"
const subscribe = (cb: () => void) => (window.addEventListener("storage", cb), () => window.removeEventListener("storage", cb))
export const readUnit = (): Unit => (localStorage.getItem(KEY) === "sats" ? "sats" : "btc")
export const useUnit = () => useSyncExternalStore(subscribe, readUnit, (): Unit => "btc")

/** Next to an amount: the chain's ticker, or the sat symbol. */
export function UnitLabel({ chain, className }: { chain: Chain; className?: string }) {
  return useUnit() === "sats" ? <SatSymbol className={className} title="sats" /> : <span className={className}>{CHAINS[chain].unit}</span>
}

/** Header switch: amounts everywhere in BTC or in sats. */
export function UnitSwitch() {
  const sats = useUnit() === "sats"
  const set = (on: boolean) => {
    localStorage.setItem(KEY, on ? "sats" : "btc")
    window.dispatchEvent(new StorageEvent("storage"))
  }
  return (
    <label className="flex cursor-pointer items-center gap-1.5 px-2 text-xs font-medium">
      <span className={cn(sats && "text-muted-foreground")}>BTC</span>
      <Switch checked={sats} onCheckedChange={set} aria-label="Show amounts in sats" />
      <SatSymbol className={cn("text-sm", !sats && "text-muted-foreground")} />
    </label>
  )
}
