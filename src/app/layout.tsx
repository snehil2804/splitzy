import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { OfflineRedirector } from "@/components/OfflineRedirector";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { ShellGate } from "@/components/ShellGate";
import { TabBar } from "@/components/TabBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Splitzy",
    template: "%s · Splitzy",
  },
  description: "Trip expenses for Snehil, Shruti & Anshul — split, sorted.",
  applicationName: "Splitzy",
  appleWebApp: {
    capable: true,
    title: "Splitzy",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No pinch/double-tap zoom — this is a native-feeling PWA, not a document
  // meant to be zoomed. Every tap target is already sized for touch.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // Mobile keyboards shrink the layout instead of overlaying the tab bar
  // on top of focused inputs.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0a12" },
  ],
};

/**
 * Runs before paint: stamps `data-theme` from the stored preference (or the
 * system) and keeps following the system while no explicit choice is stored.
 * Also deletes the legacy pre-auth "splitzy:identity" key — identity now
 * comes from the signed-in account, and a stale value from the old
 * "Who are you?" picker must never influence anything again.
 */
const themeScript = `(function(){try{localStorage.removeItem("splitzy:identity")}catch(e){}var k="splitzy:theme",m=matchMedia("(prefers-color-scheme: dark)"),d=document.documentElement,f=function(){var s=localStorage.getItem(k);d.dataset.theme=s==="light"||s==="dark"?s:m.matches?"dark":"light"};f();m.addEventListener("change",f)})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ServiceWorkerRegistrar />
        <OfflineRedirector />
        <div aria-hidden className="app-glow pointer-events-none fixed inset-0" />
        <div className="md:flex">
          {/* Sidebar + the Supabase-dependent controllers, code-split so
              Offline Mode never loads them. Renders the sidebar in the same
              DOM position as before (fragments emit no wrapper element). */}
          <ShellGate />
          <main className="relative mx-auto min-h-dvh w-full max-w-md px-4 pb-[var(--tabbar-clearance)] pt-[calc(1.25rem+env(safe-area-inset-top))] md:max-w-3xl md:px-10 md:pb-16 md:pt-12 lg:max-w-4xl">
            {children}
          </main>
        </div>
        <TabBar />
      </body>
    </html>
  );
}
