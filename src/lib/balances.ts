import { SETTLED_EPSILON } from "./constants";
import type { Expense, Member, MemberBalance, Settlement, SettlementRecord } from "./types";

/**
 * Pure balance math, computed client-side from the expense (+ settlement)
 * list so the UI never depends on the exact signature of the backend's
 * balance functions.
 */

export function computeBalances(
  members: Member[],
  expenses: Expense[],
  settlements: SettlementRecord[] = [],
): MemberBalance[] {
  const paid = new Map<string, number>();
  const share = new Map<string, number>();

  for (const expense of expenses) {
    paid.set(expense.paidById, (paid.get(expense.paidById) ?? 0) + expense.amount);
    for (const [memberId, memberShare] of Object.entries(expense.shares)) {
      share.set(memberId, (share.get(memberId) ?? 0) + memberShare);
    }
  }

  // A settlement from A to B is A paying down debt: it moves net(A) up and
  // net(B) down by the same amount, exactly as if A had "paid" B directly —
  // modeled as an adjustment on top of the paid/share totals above rather
  // than a fake expense, so paid/share still reflect real spending only.
  const settlementAdjustment = new Map<string, number>();
  for (const s of settlements) {
    settlementAdjustment.set(s.fromMemberId, (settlementAdjustment.get(s.fromMemberId) ?? 0) + s.amount);
    settlementAdjustment.set(s.toMemberId, (settlementAdjustment.get(s.toMemberId) ?? 0) - s.amount);
  }

  return members.map((member) => {
    const memberPaid = paid.get(member.id) ?? 0;
    const memberShare = share.get(member.id) ?? 0;
    const adjustment = settlementAdjustment.get(member.id) ?? 0;
    return {
      member,
      paid: memberPaid,
      share: memberShare,
      net: memberPaid - memberShare + adjustment,
    };
  });
}

/**
 * Minimum-transaction settlement. Naive largest-vs-largest greedy matching
 * is not always optimal: if a subset of members' balances happens to sum to
 * zero on its own, that subset can be settled independently, sometimes with
 * fewer transactions than greedy-matching the full group produces. This
 * first partitions members into such independent zero-sum groups (exact
 * search — trip sizes here are small, so 2^n subsets is trivial), then
 * greedily matches within each group. Provably minimal for the "distinct
 * subsets don't help" case; strictly better than or equal to plain greedy
 * in every case, since plain greedy is what each group falls back to.
 */
export function computeSettlements(balances: MemberBalance[]): Settlement[] {
  const nonZero = balances.filter((b) => Math.abs(b.net) > SETTLED_EPSILON);
  if (nonZero.length === 0) return [];

  const groups = partitionZeroSumGroups(nonZero);
  const settlements: Settlement[] = [];
  for (const group of groups) {
    settlements.push(...greedyMatch(group));
  }
  return settlements;
}

/**
 * Splits balances into the smallest number of independent groups such that
 * each group's members sum to (approximately) zero — settling a group
 * never requires paying anyone outside it. Uses cents (integers) to avoid
 * float drift when checking subset sums.
 */
function partitionZeroSumGroups(balances: MemberBalance[]): MemberBalance[][] {
  const remaining = [...balances];
  const groups: MemberBalance[][] = [];

  while (remaining.length > 0) {
    const group = findSmallestZeroSumSubset(remaining);
    groups.push(group);
    for (const b of group) {
      const idx = remaining.indexOf(b);
      remaining.splice(idx, 1);
    }
  }
  return groups;
}

/**
 * Smallest subset of `balances` whose net values sum to ~0 (searched
 * smallest-size-first, so the first match found is minimal). The full set
 * is always itself a valid fallback, since total net balance across a
 * conserved-money ledger is always ~0 — so this always terminates with a
 * real answer, never the `balances` fallback below in practice.
 */
function findSmallestZeroSumSubset(balances: MemberBalance[]): MemberBalance[] {
  const n = balances.length;
  const cents = balances.map((b) => Math.round(b.net * 100));
  const epsilonCents = Math.round(SETTLED_EPSILON * 100);

  for (let size = 1; size <= n; size++) {
    const found = findComboOfSize(cents, size, epsilonCents);
    if (found) return found.map((i) => balances[i]);
  }
  return balances;
}

/** First (lexicographically) size-k index combination summing to ~0, if any. */
function findComboOfSize(
  cents: number[],
  size: number,
  epsilonCents: number,
): number[] | null {
  const n = cents.length;
  const combo: number[] = [];

  function search(start: number, sum: number): number[] | null {
    if (combo.length === size) {
      return Math.abs(sum) <= epsilonCents ? [...combo] : null;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      const result = search(i + 1, sum + cents[i]);
      combo.pop();
      if (result) return result;
    }
    return null;
  }

  return search(0, 0);
}

/**
 * Greedy settlement within one group: repeatedly matches the largest
 * debtor with the largest creditor. Optimal for two or three people and
 * near-optimal in general — used as the within-group solver since the
 * zero-sum partitioning above already captures the cases where it isn't.
 */
function greedyMatch(balances: MemberBalance[]): Settlement[] {
  const creditors = balances
    .filter((b) => b.net > SETTLED_EPSILON)
    .map((b) => ({ member: b.member, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.net < -SETTLED_EPSILON)
    .map((b) => ({ member: b.member, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amount, debtor.amount);
    if (amount > SETTLED_EPSILON) {
      settlements.push({
        from: debtor.member,
        to: creditor.member,
        amount: Math.round(amount),
      });
    }
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount <= SETTLED_EPSILON) ci++;
    if (debtor.amount <= SETTLED_EPSILON) di++;
  }
  return settlements;
}

export function totalSpent(expenses: Expense[]): number {
  return expenses.reduce((sum, expense) => sum + expense.amount, 0);
}

/** Sum of settlements where `memberId` is the payer — "you owe" total. */
export function totalYouOwe(settlements: Settlement[], memberId: string): number {
  return settlements
    .filter((s) => s.from.id === memberId)
    .reduce((sum, s) => sum + s.amount, 0);
}

/** Sum of settlements where `memberId` is the payee — "you are owed" total. */
export function totalYouAreOwed(settlements: Settlement[], memberId: string): number {
  return settlements
    .filter((s) => s.to.id === memberId)
    .reduce((sum, s) => sum + s.amount, 0);
}
