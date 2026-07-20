"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

/**
 * Loads the Supabase-dependent app shell (`OnlineShell`) everywhere except
 * the Offline Mode routes.
 *
 * `next/dynamic` puts it in its own chunk, and because the chunk is only
 * requested when the component actually renders, `/offline` never fetches
 * it at all — which is the entire point: it keeps the ~256 kB auth SDK off
 * the critical path of the one screen that by definition has no network to
 * use it with.
 *
 * Server rendering is deliberately left on (no `ssr: false`), so on normal
 * routes the sidebar is present in the initial HTML exactly as before and
 * there is no layout shift while the chunk loads.
 */
const OnlineShell = dynamic(() => import("./OnlineShell"));

export function ShellGate() {
  const pathname = usePathname();
  if (pathname.startsWith("/offline")) return null;
  return <OnlineShell />;
}
