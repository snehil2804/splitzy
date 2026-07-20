"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { Avatar } from "./Avatar";
import {
  ActivityIcon,
  GearIcon,
  HomeIcon,
  PlusIcon,
  ReceiptIcon,
  ScaleIcon,
  SuitcaseIcon,
} from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/expenses", label: "Expenses", Icon: ReceiptIcon },
  { href: "/balances", label: "Balances", Icon: ScaleIcon },
  { href: "/activity", label: "Activity", Icon: ActivityIcon },
  { href: "/trips", label: "Trips", Icon: SuitcaseIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
] as const;

/**
 * Persistent left rail, desktop only (`md:` and up) — the bottom `TabBar`
 * stays exclusively a mobile pattern, hidden at this breakpoint. Reads the
 * same shared stores every page already uses (`useTripData`, `useSession`),
 * so it needs no new data-fetching path.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { data } = useTripData();
  const { session } = useSession();

  if (pathname === "/login" || pathname.startsWith("/join/")) return null;

  const myMember = data?.myMemberId
    ? data.members.find((m) => m.id === data.myMemberId)
    : undefined;

  return (
    <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:border-r md:border-line md:px-4 md:py-6">
      <Link href="/" className="tap flex items-center gap-2.5 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-accent text-base font-bold text-white shadow-md shadow-brand/25">
          S
        </span>
        <span className="text-lg font-bold tracking-tight">Splitzy</span>
      </Link>

      <Link
        href="/add"
        className="tap mt-6 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-brand to-accent text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-transform"
      >
        <PlusIcon className="size-4" strokeWidth={2.4} />
        Add expense
      </Link>

      <nav aria-label="Main" className="mt-6 flex-1 space-y-1">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`tap flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-soft text-brand"
                  : "text-ink-muted hover:bg-line/60 hover:text-ink"
              }`}
            >
              <Icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>

      {(myMember || session) && (
        <Link
          href="/profile"
          className="tap flex min-h-14 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-line/60"
        >
          <Avatar name={myMember?.name ?? session?.user.email ?? "?"} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {myMember?.name ?? "Your profile"}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              {session?.user.email ?? "Signed in"}
            </span>
          </span>
        </Link>
      )}
    </aside>
  );
}
