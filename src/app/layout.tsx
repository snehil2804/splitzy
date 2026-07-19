import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
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
 */
const themeScript = `(function(){var k="splitzy:theme",m=matchMedia("(prefers-color-scheme: dark)"),d=document.documentElement,f=function(){var s=localStorage.getItem(k);d.dataset.theme=s==="light"||s==="dark"?s:m.matches?"dark":"light"};f();m.addEventListener("change",f)})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <div aria-hidden className="app-glow pointer-events-none fixed inset-0" />
        <main className="relative mx-auto min-h-dvh max-w-md px-4 pb-[var(--tabbar-clearance)] pt-[calc(1.25rem+env(safe-area-inset-top))]">
          {children}
        </main>
        <TabBar />
      </body>
    </html>
  );
}
