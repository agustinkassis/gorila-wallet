"use client"

import { KeyRoundIcon, ShieldAlertIcon, ZapIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNostr } from "@/components/nostr-provider"
import { AddWalletFlow } from "@/components/add-wallet"
import { useWallet } from "@/components/wallet-provider"

/** Shows the page only once logged in and authorized; otherwise a connect/error card. */
export function Gate({ children }: { children: React.ReactNode }) {
  const { pubkey, login, logout } = useNostr()
  const { error, retry, ready, wallets, selectWallet } = useWallet()

  // Login state unknown (server render / hydration): pages render their own loading skeletons.
  if (pubkey === undefined) return children

  if (!pubkey || error)
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Card className="w-full max-w-md text-center">
          <CardHeader className="items-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400/20 to-violet-500/20">
              {error ? <ShieldAlertIcon className="size-6 text-amber-600 dark:text-amber-400" /> : <KeyRoundIcon className="size-6 text-violet-600 dark:text-violet-400" />}
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

  // first run: no .env seed and no wallet yet
  if (ready && wallets.length === 0)
    return (
      <div className="flex flex-1 items-start justify-center py-6 sm:py-12">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-xl">Welcome to Gorilla Wallet 🦍</CardTitle>
            <CardDescription>Add your first wallet: create new recovery words, restore existing ones, or watch an xpub.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddWalletFlow onDone={(w) => selectWallet(w.id)} />
          </CardContent>
        </Card>
      </div>
    )

  return children
}
