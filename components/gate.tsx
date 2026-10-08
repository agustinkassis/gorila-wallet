"use client"

import { KeyRoundIcon, ShieldAlertIcon, ZapIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNostr } from "@/components/nostr-provider"
import { useWallet } from "@/components/wallet-provider"

/** Shows the page only once logged in and authorized; otherwise a connect/error card. */
export function Gate({ children }: { children: React.ReactNode }) {
  const { pubkey, login, logout } = useNostr()
  const { error, retry } = useWallet()

  // Login state unknown (server render / hydration): pages render their own loading skeletons.
  if (pubkey === undefined) return children

  if (!pubkey || error)
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Card className="w-full max-w-md text-center">
          <CardHeader className="items-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400/20 to-violet-500/20">
              {error ? <ShieldAlertIcon className="size-6 text-amber-400" /> : <KeyRoundIcon className="size-6 text-violet-400" />}
            </div>
            <CardTitle className="text-xl">{error ? "Access problem" : "Connect with Nostr"}</CardTitle>
            <CardDescription>
              {error ?? "Sign in with your NIP-07 browser extension to open Gorilla Wallet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            {error ? (
              <>
                <Button onClick={retry}>Retry</Button>
                <Button variant="outline" onClick={logout}>
                  Switch account
                </Button>
              </>
            ) : (
              <Button onClick={login} className="gap-2">
                <ZapIcon /> Connect Nostr
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    )

  return children
}
