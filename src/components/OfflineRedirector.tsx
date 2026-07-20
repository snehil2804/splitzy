"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const EXEMPT_PATHS = ["/offline", "/offline/add", "/login"];

function isExempt(pathname: string): boolean {
  if (EXEMPT_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/join/")) return true;
  return false;
}

/**
 * Forces navigation into the dedicated Offline Mode whenever connectivity
 * drops on a route that depends on live server data (dashboard, balances,
 * trips, activity, invitations, settings, the online Add/Edit form...) —
 * those must never be shown as if their data were current. `/login` and
 * `/join/[token]` are exempt: being offline there just means the form can't
 * submit, it doesn't risk showing stale live data as current.
 */
export function OfflineRedirector() {
  const online = useOnlineStatus();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (online) return;
    if (isExempt(pathname)) return;
    router.replace("/offline");
  }, [online, pathname, router]);

  return null;
}
