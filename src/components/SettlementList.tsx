"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import type { Settlement } from "@/lib/types";
import { Avatar } from "./Avatar";
import { ArrowRightIcon, CheckIcon, ChevronRightIcon } from "./icons";

interface SettlementListProps {
  settlements: Settlement[];
  /** Name of the person using this device, for "You / you" framing. */
  identity?: string | null;
  /** When provided, each row gets a "Mark as paid" action that records it. */
  onSettle?: (s: Settlement) => void;
  /** `${from.id}-${to.id}` of the settlement currently being recorded, if any. */
  settlingKey?: string | null;
}

/**
 * Explains why this specific transaction exists, in plain language, using
 * only the already-computed settlement list — no new balance math. When a
 * debtor's total is split across more than one creditor (the settlement
 * optimizer routes to whichever creditor is currently largest, not
 * necessarily who they "originally" owed for a given expense), this walks
 * through each piece so the routing doesn't look arbitrary.
 */
export function explainSettlement(settlement: Settlement, allSettlements: Settlement[]): string {
  const fromSettlements = allSettlements.filter((s) => s.from.id === settlement.from.id);
  if (fromSettlements.length <= 1) {
    return `This settles ${settlement.from.name}'s entire remaining balance on the trip.`;
  }

  const total = fromSettlements.reduce((sum, s) => sum + s.amount, 0);
  const pieces = fromSettlements.map((s, i) => {
    const isFirst = i === 0;
    const isLast = i === fromSettlements.length - 1;
    const amount = formatINR(s.amount);
    const lead = isFirst ? amount : isLast ? `The remaining ${amount}` : `Another ${amount}`;
    return `${lead} settles ${s.to.name}'s remaining balance.`;
  });

  return `${settlement.from.name} owes ${formatINR(total)} overall. ${pieces.join(" ")} This minimizes the total number of transactions.`;
}

export function SettlementList({
  settlements,
  identity,
  onSettle,
  settlingKey,
}: SettlementListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (settlements.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-positive/10 p-4">
        <span className="text-2xl">🎉</span>
        <p className="text-sm font-medium text-positive">
          All settled up — nobody owes anything!
        </p>
      </div>
    );
  }

  const isYou = (name: string) =>
    identity != null && name.toLowerCase() === identity.toLowerCase();

  return (
    <ul className="space-y-2.5">
      {settlements.map((s) => {
        const key = `${s.from.id}-${s.to.id}`;
        const settling = settlingKey === key;
        const expanded = expandedKey === key;
        return (
          <li key={key} className="overflow-hidden rounded-2xl bg-line/60">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => setExpandedKey(expanded ? null : key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedKey(expanded ? null : key);
                }
              }}
              className="tap flex items-center gap-3 p-3.5"
            >
              <Avatar name={s.from.name} size="sm" />
              <ArrowRightIcon className="size-4 shrink-0 text-ink-faint" />
              <Avatar name={s.to.name} size="sm" />
              <p className="min-w-0 flex-1 text-sm leading-snug">
                <span className="font-medium">
                  {isYou(s.from.name) ? "You" : s.from.name}
                </span>{" "}
                {isYou(s.from.name) ? "pay" : "pays"}{" "}
                <span className="font-medium">
                  {isYou(s.to.name) ? "you" : s.to.name}
                </span>
              </p>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatINR(s.amount)}
              </span>
              <ChevronRightIcon
                className={`size-3.5 shrink-0 text-ink-faint transition-transform ${expanded ? "rotate-90" : ""}`}
              />
              {onSettle && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSettle(s);
                  }}
                  disabled={settling}
                  aria-label={`Mark ${s.from.name} → ${s.to.name} as paid`}
                  className="tap grid size-8 shrink-0 place-items-center rounded-full bg-positive/10 text-positive disabled:opacity-50"
                >
                  <CheckIcon className="size-4" strokeWidth={2.4} />
                </button>
              )}
            </div>
            {expanded && (
              <div className="anim-fade-in border-t border-surface-strong/60 px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
                {explainSettlement(s, settlements)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
