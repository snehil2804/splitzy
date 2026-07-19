import type { ExpenseSplitInput, SplitType } from "./types";

/**
 * Mirrors the validation inside `compute_expense_splits()` so the form can
 * reject bad input before hitting the RPC — the database is still the
 * authority; this is purely a faster feedback loop.
 */
const PRECISION_EPSILON = 0.01;

export interface SplitValidationResult {
  error: string | null;
  splits: ExpenseSplitInput[] | null;
}

export function validateSplit(
  splitType: SplitType,
  participantIds: string[],
  rawValues: Record<string, string>,
  amount: number,
): SplitValidationResult {
  if (splitType === "equal") {
    return { error: null, splits: null };
  }

  const splits: ExpenseSplitInput[] = [];
  for (const memberId of participantIds) {
    const raw = rawValues[memberId]?.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0) {
      return { error: "Enter a positive value for everyone in the split.", splits: null };
    }
    splits.push({ memberId, value });
  }

  const sum = splits.reduce((total, s) => total + s.value, 0);

  if (splitType === "exact" && Math.abs(sum - amount) > PRECISION_EPSILON) {
    return {
      error: `Amounts must add up to ₹${amount.toFixed(2)} (currently ₹${sum.toFixed(2)}).`,
      splits: null,
    };
  }

  if (splitType === "percentage" && Math.abs(sum - 100) > PRECISION_EPSILON) {
    return {
      error: `Percentages must add up to 100% (currently ${sum.toFixed(2)}%).`,
      splits: null,
    };
  }

  return { error: null, splits };
}
