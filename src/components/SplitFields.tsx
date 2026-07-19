"use client";

import type { Member, SplitType } from "@/lib/types";

const SPLIT_OPTIONS: { value: SplitType; label: string }[] = [
  { value: "equal", label: "Equal" },
  { value: "exact", label: "Exact" },
  { value: "percentage", label: "Percent" },
  { value: "shares", label: "Shares" },
];

interface SplitFieldsProps {
  splitType: SplitType;
  onSplitTypeChange: (type: SplitType) => void;
  members: Member[];
  participantIds: string[];
  values: Record<string, string>;
  onValueChange: (memberId: string, value: string) => void;
  animationDelay?: string;
}

/** Split-method selector + per-participant value inputs, shared by Add and Edit expense forms. */
export function SplitFields({
  splitType,
  onSplitTypeChange,
  members,
  participantIds,
  values,
  onValueChange,
  animationDelay,
}: SplitFieldsProps) {
  const participants = members.filter((m) => participantIds.includes(m.id));
  const unit = splitType === "exact" ? "₹" : splitType === "percentage" ? "%" : "";

  return (
    <section
      className="anim-fade-up glass space-y-4 rounded-3xl p-5"
      style={animationDelay ? { animationDelay } : undefined}
    >
      <h2 className="text-sm font-semibold">How to split</h2>
      <div className="grid grid-cols-4 gap-2 rounded-2xl bg-line/60 p-1.5">
        {SPLIT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSplitTypeChange(option.value)}
            aria-pressed={splitType === option.value}
            className={`tap rounded-xl py-2 text-xs font-semibold transition-colors ${
              splitType === option.value
                ? "bg-surface-strong text-brand shadow-sm"
                : "text-ink-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {splitType !== "equal" && (
        <div className="anim-fade-in space-y-2">
          {participants.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm font-medium">{m.name}</span>
              <div className="relative w-28">
                {unit === "₹" && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint">
                    ₹
                  </span>
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={values[m.id] ?? ""}
                  onChange={(e) => onValueChange(m.id, e.target.value)}
                  placeholder="0"
                  className={`w-full rounded-xl border-2 border-transparent bg-line/60 py-2 text-sm tabular-nums outline-none transition-colors focus:border-brand ${
                    unit === "₹" ? "pl-7 pr-3" : "px-3"
                  }`}
                />
                {unit === "%" && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint">
                    %
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
