"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearIcon, HomeIcon, PlusIcon, ReceiptIcon, ScaleIcon } from "./icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/expenses", label: "Expenses", Icon: ReceiptIcon },
  { href: "/add", label: "Add expense", Icon: PlusIcon, fab: true },
  { href: "/balances", label: "Balances", Icon: ScaleIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  if (pathname === "/login" || pathname.startsWith("/join/")) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-strong/95 backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex max-w-md items-center justify-between px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {TABS.map(({ href, label, Icon, ...tab }) => {
          const active = pathname === href;
          if ("fab" in tab && tab.fab) {
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className="tap -mt-7 grid size-14 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-white shadow-xl shadow-brand/30 ring-4 ring-canvas"
              >
                <Icon className="size-6" strokeWidth={2.2} />
              </Link>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`tap flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 transition-colors ${
                active ? "text-brand" : "text-ink-faint hover:text-ink-muted"
              }`}
            >
              <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
