import { formatINR } from "@/lib/format";
import type { Settlement } from "@/lib/types";
import { Avatar } from "./Avatar";
import { ArrowRightIcon } from "./icons";

interface SettlementListProps {
  settlements: Settlement[];
  /** Name of the person using this device, for "You / you" framing. */
  identity?: string | null;
}

export function SettlementList({ settlements, identity }: SettlementListProps) {
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
      {settlements.map((s) => (
        <li
          key={`${s.from.id}-${s.to.id}`}
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
        </li>
      ))}
    </ul>
  );
}
