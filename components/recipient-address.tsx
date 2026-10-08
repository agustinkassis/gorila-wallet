"use client"

import { BookUserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { shorten } from "@/components/site-header"
import { UnitLabel, useUnit } from "@/components/units"
import { useWallet } from "@/components/wallet-provider"
import { FAMILIES, formatAmount, nextUnused, type Chain } from "@/lib/wallet"

/** Your own receive addresses on `chain`, per wallet: used or labeled ones, plus the next unused one. */
function useMyAddresses(chain: Chain) {
  const { wallets, allSnapshots } = useWallet()
  return wallets.flatMap((w) => {
    const next = nextUnused(allSnapshots[w.id] ?? {}, 0)?.address
    const list = (allSnapshots[w.id]?.[chain]?.addresses ?? [])
      .filter((a) => a.change === 0 && (a.used || a.label || a.address === next))
      .sort((a, b) => a.index - b.index)
      .map((a) => ({ ...a, name: a.label ?? (a.address === next ? "Next unused" : `Receive #${a.index}`) }))
    return list.length ? [{ wallet: w, list }] : []
  })
}

/** Recipient address field with a picker for your own addresses (any wallet), showing labels and balances. */
export function RecipientAddress({
  chain,
  value,
  onChange,
  disabled,
  index,
}: {
  chain: Chain
  value: string
  onChange: (address: string) => void
  disabled?: boolean
  index: number
}) {
  const { wallet, family } = useWallet()
  const unit = useUnit()
  const groups = useMyAddresses(chain)
  const mine = groups.flatMap((g) => g.list.map((a) => ({ ...a, wallet: g.wallet }))).find((a) => a.address === value.trim())

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative">
        <Input
          disabled={disabled}
          placeholder={`${FAMILIES[family].network.bech32}1… address`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10 font-mono text-xs"
          aria-label={`Recipient ${index + 1} address`}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled || groups.length === 0}
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-md text-muted-foreground"
              aria-label="Pick one of my addresses"
              title="My addresses"
            >
              <BookUserIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
            {groups.map(({ wallet: w, list }, gi) => (
              <DropdownMenuGroup key={w.id}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {w.name}
                  {w.id === wallet?.id && " · this wallet"}
                </DropdownMenuLabel>
                {list.map((a) => (
                  <DropdownMenuItem key={a.address} onSelect={() => onChange(a.address)} className="gap-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{a.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{shorten(a.address, 10)}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {formatAmount(a.confirmed + a.unconfirmed, unit)} <UnitLabel chain={chain} />
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mine && (
        <p className="truncate px-1 text-xs text-muted-foreground">
          {mine.wallet.id === wallet?.id ? "This wallet" : mine.wallet.name} · {mine.name}
        </p>
      )}
    </div>
  )
}
