"use client";

import { useMemo } from "react";
import { Avatar } from "@/components/Avatar";
import { SettlementList } from "@/components/SettlementList";
import { CardSkeleton } from "@/components/Skeleton";
import { AccessDeniedState, EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
import { useTripData } from "@/hooks/useTripData";
import { computeBalances, computeSettlements } from "@/lib/balances";
import { formatINR } from "@/lib/format";

export default function BalancesPage() {
  const { status, data, error, refresh } = useTripData();
  const myName =
    data?.members.find((m) => m.id === data.myMemberId)?.name ?? null;

  const derived = useMemo(() => {
    if (!data) return null;
    const balances = computeBalances(data.members, data.expenses);
    return { balances, settlements: computeSettlements(balances) };
  }, [data]);

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Balances</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Who paid, who owes, and the fastest way to settle.
        </p>
      </header>

      {status === "unconfigured" && <SetupNotice />}

      {status === "loading" && (
        <div className="space-y-4">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      )}

      {status === "error" && <ErrorState message={error ?? ""} onRetry={refresh} />}
      {status === "forbidden" && <AccessDeniedState onRetry={refresh} />}

      {status === "ready" && data && derived && (
        <>
          {data.expenses.length === 0 ? (
            <EmptyState
              emoji="⚖️"
              title="Perfectly balanced"
              message="No expenses yet, so nobody owes anyone. Add your first expense to see the magic."
            />
          ) : (
            <>
              {/* Per-member breakdown */}
              <section className="space-y-3">
                {derived.balances.map((balance, i) => {
                  const settled = Math.abs(balance.net) < 1;
                  const isYou = balance.member.id === data.myMemberId;
                  return (
                    <article
                      key={balance.member.id}
                      className="anim-fade-up glass rounded-3xl p-5"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar name={balance.member.name} size="md" />
                        <div className="flex-1">
                          <h2 className="font-semibold">
                            {balance.member.name}
                            {isYou && (
                              <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                                you
                              </span>
                            )}
                          </h2>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
                            settled
                              ? "bg-line text-ink-muted"
                              : balance.net > 0
                                ? "bg-positive/10 text-positive"
                                : "bg-negative/10 text-negative"
                          }`}
                        >
                          {settled
                            ? "Settled"
                            : `${balance.net > 0 ? "+" : "−"}${formatINR(Math.abs(balance.net))}`}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-center">
                        <div className="rounded-2xl bg-line/60 py-2.5">
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                            Paid
                          </dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                            {formatINR(balance.paid)}
                          </dd>
                        </div>
                        <div className="rounded-2xl bg-line/60 py-2.5">
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                            Share
                          </dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                            {formatINR(balance.share)}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </section>

              {/* How to settle */}
              <section
                className="anim-fade-up glass rounded-3xl p-5"
                style={{ animationDelay: "200ms" }}
              >
                <h2 className="mb-3.5 text-sm font-semibold text-ink-muted">
                  How to settle up
                </h2>
                <SettlementList
                  settlements={derived.settlements}
                  identity={myName}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
