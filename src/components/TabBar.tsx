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

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="glass flex items-center justify-between rounded-[1.75rem] px-3 py-2">
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
              className={`tap flex min-w-14 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 transition-colors ${
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
