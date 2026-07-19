import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBalances, computeSettlements, totalSpent } from "../src/lib/balances";
import type { Expense, Member } from "../src/lib/types";

const snehil: Member = { id: "m1", name: "Snehil", userId: "u1", role: "owner" };
const shruti: Member = { id: "m2", name: "Shruti", userId: null, role: "member" };
const anshul: Member = { id: "m3", name: "Anshul", userId: null, role: "member" };
const members = [snehil, shruti, anshul];

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: "e1",
    tripId: "t1",
    description: "Test Dinner",
    emoji: "🍽️",
    amount: 900,
    paidById: snehil.id,
    paymentApp: null,
    shares: { m1: 300, m2: 300, m3: 300 },
    participantIds: ["m1", "m2", "m3"],
    locationName: null,
    date: new Date("2026-07-19"),
    ...overrides,
  };
}

test("₹900 dinner paid by Snehil, equal 3-way split", () => {
  const balances = computeBalances(members, [expense({})]);
  const byId = new Map(balances.map((b) => [b.member.id, b]));

  assert.equal(byId.get("m1")!.paid, 900);
  assert.equal(byId.get("m1")!.share, 300);
  assert.equal(byId.get("m1")!.net, 600);

  for (const id of ["m2", "m3"]) {
    assert.equal(byId.get(id)!.paid, 0);
    assert.equal(byId.get(id)!.share, 300);
    assert.equal(byId.get(id)!.net, -300);
  }

  assert.equal(totalSpent([expense({})]), 900);
});

test("settlements: both debtors pay Snehil ₹300", () => {
  const balances = computeBalances(members, [expense({})]);
  const settlements = computeSettlements(balances);
  assert.equal(settlements.length, 2);
  for (const s of settlements) {
    assert.equal(s.to.id, snehil.id);
    assert.equal(s.amount, 300);
  }
});

test("partial split: only two participants share", () => {
  const e = expense({
    amount: 100,
    shares: { m1: 50, m2: 50 },
    participantIds: ["m1", "m2"],
  });
  const byId = new Map(computeBalances(members, [e]).map((b) => [b.member.id, b]));
  assert.equal(byId.get("m1")!.net, 50);
  assert.equal(byId.get("m2")!.net, -50);
  assert.equal(byId.get("m3")!.net, 0);
});

test("members with no expenses balance to zero", () => {
  const balances = computeBalances(members, []);
  for (const b of balances) assert.equal(b.net, 0);
  assert.equal(computeSettlements(balances).length, 0);
});

test("payer outside the member list still counts toward shares", () => {
  // Historical member removed from the trip roster: their share still exists
  // in the expense, but they no longer appear in balances.
  const e = expense({});
  const balances = computeBalances([snehil, shruti], [e]);
  assert.equal(balances.length, 2);
  const byId = new Map(balances.map((b) => [b.member.id, b]));
  assert.equal(byId.get("m1")!.net, 600);
});
