"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ExpenseCard } from "@/components/ExpenseCard";
import { ChevronRightIcon, PlusIcon, ScaleIcon } from "@/components/icons";
import { SettlementList } from "@/components/SettlementList";
import { CardSkeleton, ListSkeleton, Skeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
import { useIdentity } from "@/hooks/useIdentity";
import { useTripData } from "@/hooks/useTripData";
import { computeBalances, computeSettlements, totalSpent } from "@/lib/balances";
import { formatINR, greetingForHour } from "@/lib/format";

const RECENT_COUNT = 3;

/** Time-of-day greeting, hydration-safe: the prerendered HTML says "Hey". */
const noopSubscribe = () => () => {};
function useGreeting() {
  return useSyncExternalStore(
    noopSubscribe,
    () => greetingForHour(new Date().getHours()),
    () => "Hey",
  );
}

export default function DashboardPage() {
  const { status, data, error, refresh } = useTripData();
  const identity = useIdentity();
  const greeting = useGreeting();

  const derived = useMemo(() => {
    if (!data) return null;
    const balances = computeBalances(data.members, data.expenses);
    return {
      balances,
      settlements: computeSettlements(balances),
      total: totalSpent(data.expenses),
      membersById: new Map(data.members.map((m) => [m.id, m])),
      recent: data.expenses.slice(0, RECENT_COUNT),
    };
  }, [data]);

  const myBalance = derived?.balances.find(
    (b) => identity && b.member.name.toLowerCase() === identity.toLowerCase(),
  );

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <p className="text-sm font-medium text-ink-muted">
          {greeting}
          {identity ? `, ${identity}` : ""} 👋
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {data?.trip ? data.trip.name : "Your trip, split fairly"}
        </h1>
      </header>

      {status === "unconfigured" && <SetupNotice />}

      {status === "loading" && (
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-[2rem]" />
          <CardSkeleton lines={3} />
          <ListSkeleton count={3} />
        </div>
      )}

      {status === "error" && <ErrorState message={error ?? ""} onRetry={refresh} />}

      {status === "ready" && data && derived && (
        <>
          {/* Hero: trip total */}
          <section className="anim-fade-up relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand via-violet-500 to-accent p-6 text-white shadow-xl shadow-brand/25">
            <div className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full bg-white/15 blur-2xl" />
            <p className="text-sm font-medium text-white/75">Total spent</p>
            <p className="mt-1 text-4xl font-bold tracking-tight">
              <AnimatedNumber value={derived.total} />
            </p>
            <div className="mt-4 flex items-center gap-4 text-[13px] text-white/80">
              <span>
                {data.expenses.length}{" "}
                {data.expenses.length === 1 ? "expense" : "expenses"}
              </span>
              <span className="size-1 rounded-full bg-white/50" />
              <span>
                {formatINR(
                  data.members.length ? derived.total / data.members.length : 0,
                )}{" "}
                per person
              </span>
            </div>
          </section>

          {/* Personal balance, when the device knows who you are */}
          {myBalance && (
            <section
              className="anim-fade-up glass rounded-3xl p-5"
              style={{ animationDelay: "60ms" }}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink-muted">
                  Your balance
                </h2>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    Math.abs(myBalance.net) < 1
                      ? "text-ink-muted"
                      : myBalance.net > 0
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {myBalance.net > 0 ? "+" : ""}
                  {formatINR(myBalance.net)}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {Math.abs(myBalance.net) < 1
                  ? "You're all square. Nice."
                  : myBalance.net > 0
                    ? "The group owes you — enjoy it."
                    : "You owe the group a little."}
              </p>
            </section>
          )}

          {/* Settlements */}
          <section
            className="anim-fade-up glass rounded-3xl p-5"
            style={{ animationDelay: "120ms" }}
          >
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-muted">
                Settling up
              </h2>
              <Link
                href="/balances"
                className="tap flex items-center gap-0.5 text-xs font-semibold text-brand"
              >
                Details
                <ChevronRightIcon className="size-3.5" />
              </Link>
            </div>
            <SettlementList settlements={derived.settlements} identity={identity} />
          </section>

          {/* Recent expenses */}
          <section className="anim-fade-up" style={{ animationDelay: "180ms" }}>
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-ink-muted">
                Recent expenses
              </h2>
              {data.expenses.length > RECENT_COUNT && (
                <Link
                  href="/expenses"
                  className="tap flex items-center gap-0.5 text-xs font-semibold text-brand"
                >
                  See all
                  <ChevronRightIcon className="size-3.5" />
                </Link>
              )}
            </div>
            {derived.recent.length === 0 ? (
              <EmptyState
                emoji="🌴"
                title="No expenses yet"
                message="The first chai, cab or hotel you log will show up here."
              />
            ) : (
              <div className="space-y-3">
                {derived.recent.map((expense, i) => (
                  <ExpenseCard
                    key={expense.id}
                    expense={expense}
                    membersById={derived.membersById}
                    compact
                    index={i}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Quick actions */}
          <section
            className="anim-fade-up grid grid-cols-2 gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              href="/add"
              className="tap flex items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/25"
            >
              <PlusIcon className="size-4" strokeWidth={2.4} />
              Add expense
            </Link>
            <Link
              href="/balances"
              className="tap glass flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold"
            >
              <ScaleIcon className="size-4" />
              Balances
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
