"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowDownLeftIcon, ArrowLeftRightIcon, ArrowUpRightIcon, CoinsIcon, LayoutDashboardIcon, SettingsIcon } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useWallet } from "@/components/wallet-provider"
import { CHAINS, pendingIncoming } from "@/lib/wallet"
import { cn } from "@/lib/utils"

export const NAV = [
  { href: "/", title: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/send", title: "Send", icon: ArrowUpRightIcon },
  { href: "/receive", title: "Receive", icon: ArrowDownLeftIcon },
  { href: "/transactions", title: "Transactions", icon: ArrowLeftRightIcon, showsIncoming: true },
  { href: "/utxos", title: "UTXOs", icon: CoinsIcon },
  { href: "/settings", title: "Settings", icon: SettingsIcon },
]

/** Pulsing dot that marks an unconfirmed incoming payment. */
export function IncomingDot({ className }: { className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute flex size-2", className)}>
      <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
    </span>
  )
}

export function StatusDot({ on, className }: { on: boolean; className?: string }) {
  return (
    <span className={cn("relative flex size-2", className)}>
      {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cn("relative inline-flex size-2 rounded-full", on ? "bg-emerald-400" : "bg-amber-400")} />
    </span>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const { snapshots, live, chains } = useWallet()
  const incoming = pendingIncoming(snapshots).length

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-violet-500 text-lg shadow-md">
                  <span aria-hidden>🦍</span>
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Gorilla Wallet</span>
                  <span className="truncate text-xs text-muted-foreground">{chains.includes("xbt") ? "Bitcoin · Blake2b" : "Bitcoin"}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Wallet</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    tooltip={item.showsIncoming && incoming ? `${item.title} · ${incoming} incoming` : item.title}
                  >
                    <Link href={item.href} onClick={() => setOpenMobile(false)} className="relative">
                      <item.icon />
                      <span>{item.title}</span>
                      {item.showsIncoming && incoming > 0 && (
                        <>
                          <IncomingDot className="top-1.5 left-5" />
                          <span className="ml-auto text-xs font-medium text-emerald-400 group-data-[collapsible=icon]:hidden">
                            {incoming} incoming
                          </span>
                        </>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {chains.map((chain) => {
            const s = snapshots[chain]
            const on = live && !!s?.connected
            return (
              <SidebarMenuItem key={chain}>
                <SidebarMenuButton
                  size="sm"
                  className="pointer-events-none"
                  tooltip={`${CHAINS[chain].label}: ${on ? `live via ${s?.server}` : "reconnecting"}`}
                >
                  <StatusDot on={on} className="mx-1" />
                  <span className="flex-1">{CHAINS[chain].label}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {s?.height ? `#${s.height.toLocaleString()}` : "—"}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
