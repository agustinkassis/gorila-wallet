"use client"

import { usePathname } from "next/navigation"
import { nip19 } from "nostr-tools"
import { useTheme } from "next-themes"
import { BellIcon, CopyIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { IncomingDot, NAV } from "@/components/app-sidebar"
import { useNostr } from "@/components/nostr-provider"
import { useWallet } from "@/components/wallet-provider"
import { WatchOnlyBadge } from "@/components/wallet-switcher"
import { canNotify, requestNotifications } from "@/lib/notify"
import { pendingIncoming } from "@/lib/wallet"

export const shorten = (s: string, n = 8) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s)

export function copy(text: string, label = "Copied") {
  navigator.clipboard.writeText(text).then(() => toast.success(label))
}

export function SiteHeader() {
  const pathname = usePathname()
  const { pubkey, profile, login, logout } = useNostr()
  const { snapshots, watchOnly } = useWallet()
  const incoming = pendingIncoming(snapshots).length > 0
  const title = NAV.find((n) => n.href === pathname)?.title ?? "Gorilla Wallet"
  const npub = pubkey ? nip19.npubEncode(pubkey) : ""
  const name = profile?.display_name || profile?.name || shorten(npub, 6)

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/80 px-4 backdrop-blur">
      <div className="relative -ml-1">
        <SidebarTrigger />
        {incoming && <IncomingDot className="top-1 right-1 md:hidden" />}
      </div>
      <h1 className="text-sm font-medium">{title}</h1>
      {watchOnly && <WatchOnlyBadge className="hidden sm:inline-flex" />}

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        {pubkey === undefined ? (
          <Skeleton className="size-8 rounded-full" />
        ) : pubkey ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 rounded-full pr-3 pl-1">
                <Avatar className="size-7 ring-2 ring-violet-500/40">
                  <AvatarImage src={profile?.picture} alt={name} />
                  <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="hidden max-w-32 truncate text-sm sm:inline">{name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="truncate">{name}</span>
                <span className="truncate font-mono text-xs font-normal text-muted-foreground">{shorten(npub, 12)}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => copy(npub, "npub copied")}>
                <CopyIcon /> Copy npub
              </DropdownMenuItem>
              {canNotify() && Notification.permission === "default" && (
                <DropdownMenuItem onSelect={requestNotifications}>
                  <BellIcon /> Enable notifications
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={logout}>
                <LogOutIcon /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" onClick={login} className="gap-2">
            <ZapIcon /> Connect Nostr
          </Button>
        )}
      </div>
    </header>
  )
}

/** Light / Dark / System. The icon swaps via CSS so server and client render the same markup. */
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <SunIcon className="dark:hidden" />
          <MoonIcon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
