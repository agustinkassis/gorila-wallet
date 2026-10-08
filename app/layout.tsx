import type { Metadata } from "next"
import { ThemeProvider } from "next-themes"
import { Geist, Geist_Mono } from "next/font/google"
import { AppSidebar } from "@/components/app-sidebar"
import { Gate } from "@/components/gate"
import { NostrProvider } from "@/components/nostr-provider"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WalletProvider } from "@/components/wallet-provider"
import "./globals.css"

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Gorilla Wallet",
  description: "Bitcoin wallet with Nostr login and an optional Blake2b (XBT) extension",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider>
          <NostrProvider>
            <WalletProvider>
              <SidebarProvider>
                <AppSidebar />
                <SidebarInset className="min-w-0">
                  <SiteHeader />
                  <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
                    <Gate>{children}</Gate>
                  </main>
                </SidebarInset>
              </SidebarProvider>
            </WalletProvider>
          </NostrProvider>
        </TooltipProvider>
        <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
