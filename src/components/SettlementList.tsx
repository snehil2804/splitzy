import { formatINR } from "@/lib/format";
import type { Settlement } from "@/lib/types";
import { Avatar } from "./Avatar";
import { ArrowRightIcon, CheckIcon } from "./icons";

interface SettlementListProps {
  settlements: Settlement[];
  /** Name of the person using this device, for "You / you" framing. */
  identity?: string | null;
  /** When provided, each row gets a "Mark as paid" action that records it. */
  onSettle?: (s: Settlement) => void;
  /** `${from.id}-${to.id}` of the settlement currently being recorded, if any. */
  settlingKey?: string | null;
}

export function SettlementList({
  settlements,
  identity,
  onSettle,
  settlingKey,
}: SettlementListProps) {
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
        return (
          <li
            key={key}
            className="flex items-center gap-3 rounded-2xl bg-line/60 p-3.5"
          >
            <Avatar name={s.from.name} size="sm" />
            <ArrowRightIcon className="size-4 shrink-0 text-ink-faint" />
            <Avatar name={s.to.name} size="sm" />
            <p className="min-w-0 flex-1 truncate text-sm">
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
            {onSettle && (
              <button
                type="button"
                onClick={() => onSettle(s)}
                disabled={settling}
                aria-label={`Mark ${s.from.name} → ${s.to.name} as paid`}
                className="tap grid size-8 shrink-0 place-items-center rounded-full bg-positive/10 text-positive disabled:opacity-50"
              >
                <CheckIcon className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
