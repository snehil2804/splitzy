"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ExpenseCard } from "@/components/ExpenseCard";
import { ChevronRightIcon, PlusIcon, ScaleIcon } from "@/components/icons";
import { SettlementList } from "@/components/SettlementList";
import { CardSkeleton, ListSkeleton, Skeleton } from "@/components/Skeleton";
import { AccessDeniedState, EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
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
  const greeting = useGreeting();

  const derived = useMemo(() => {
    if (!data) return null;
    const balances = computeBalances(data.members, data.expenses, data.settlements);
    return {
      balances,
      settlements: computeSettlements(balances),
      total: totalSpent(data.expenses),
      membersById: new Map(data.members.map((m) => [m.id, m])),
      recent: data.expenses.slice(0, RECENT_COUNT),
    };
  }, [data]);

  const myMember = data?.myMemberId
    ? data.members.find((m) => m.id === data.myMemberId)
    : undefined;
  const myBalance = derived?.balances.find(
    (b) => data?.myMemberId && b.member.id === data.myMemberId,
  );

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <p className="text-sm font-medium text-ink-muted">
          {greeting}
          {myMember ? `, ${myMember.name}` : ""} 👋
        </p>
        <Link
          href="/trips"
          className="tap mt-1 inline-flex items-center gap-1.5 text-2xl font-bold tracking-tight"
        >
          {data?.trip ? data.trip.name : "Your trips"}
          <ChevronRightIcon className="mt-1 size-5 text-ink-faint" />
        </Link>
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

      {status === "forbidden" && <AccessDeniedState onRetry={refresh} />}

      {status === "ready" && data && !data.trip && (
        <EmptyState
          emoji="🧳"
          title="No trips yet"
          message="Create your first trip and invite the people you're travelling with."
          action={
            <Link
              href="/trips"
              className="tap mt-2 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/25"
            >
              <PlusIcon className="size-4" strokeWidth={2.4} />
              Create a trip
            </Link>
          }
        />
      )}

      {status === "ready" && data && data.trip && derived && (
        <>
          {/* Hero: trip total + personal stats */}
          <section className="anim-fade-up relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand via-violet-500 to-accent p-6 text-white shadow-xl shadow-brand/25">
            <div className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full bg-white/15 blur-2xl" />
            <p className="text-sm font-medium text-white/75">Trip Total</p>
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
                {data.members.length}{" "}
                {data.members.length === 1 ? "member" : "members"}
              </span>
            </div>
          </section>

          {/* Personal stats, when the account is linked to a trip member */}
          {myBalance && (
            <section
              className="anim-fade-up grid grid-cols-3 gap-3"
              style={{ animationDelay: "60ms" }}
            >
              <StatTile label="You Paid" value={formatINR(myBalance.paid)} />
              <StatTile label="Your Share" value={formatINR(myBalance.share)} />
              <StatTile
                label="Your Balance"
                value={`${myBalance.net > 0 ? "+" : ""}${formatINR(myBalance.net)}`}
                tone={
                  Math.abs(myBalance.net) < 1
                    ? "muted"
                    : myBalance.net > 0
                      ? "positive"
                      : "negative"
                }
              />
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
            <SettlementList
              settlements={derived.settlements}
              identity={myMember?.name ?? null}
            />
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
              className="tap flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/25"
            >
              <PlusIcon className="size-4" strokeWidth={2.4} />
              Add expense
            </Link>
            <Link
              href="/balances"
              className="tap glass flex min-h-12 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold"
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

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "muted"
          ? "text-ink-muted"
          : "";
  return (
    <div className="glass flex flex-col gap-1 rounded-3xl p-4">
      <span className="text-[11px] font-semibold text-ink-muted">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}
