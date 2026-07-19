import { SETTLED_EPSILON } from "./constants";
import type { Expense, Member, MemberBalance, Settlement } from "./types";

/**
 * Pure balance math, computed client-side from the expense list so the UI
 * never depends on the exact signature of the backend's balance functions.
 */

export function computeBalances(
  members: Member[],
  expenses: Expense[],
): MemberBalance[] {
  const paid = new Map<string, number>();
  const share = new Map<string, number>();

  for (const expense of expenses) {
    paid.set(expense.paidById, (paid.get(expense.paidById) ?? 0) + expense.amount);
    for (const [memberId, memberShare] of Object.entries(expense.shares)) {
      share.set(memberId, (share.get(memberId) ?? 0) + memberShare);
    }
  }

  return members.map((member) => {
    const memberPaid = paid.get(member.id) ?? 0;
    const memberShare = share.get(member.id) ?? 0;
    return {
      member,
      paid: memberPaid,
      share: memberShare,
      net: memberPaid - memberShare,
    };
  });
}

/**
 * Greedy settlement: repeatedly matches the largest debtor with the largest
 * creditor. Optimal for three people and near-optimal in general.
 */
export function computeSettlements(balances: MemberBalance[]): Settlement[] {
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
