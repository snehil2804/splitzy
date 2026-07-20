import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBalances, computeSettlements, totalSpent } from "../src/lib/balances";
import type { Expense, Member, MemberBalance, SettlementRecord } from "../src/lib/types";

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
    locationFormattedAddress: null,
    latitude: null,
    longitude: null,
    locationPlaceId: null,
    date: new Date("2026-07-19"),
    createdBy: null,
    splitType: "equal",
    category: null,
    notes: null,
    currency: "INR",
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

test("settlements: a recorded payment reduces both parties' net balance", () => {
  const e = expense({});
  const balances = computeBalances(members, [e]);
  const byIdBefore = new Map(balances.map((b) => [b.member.id, b]));
  assert.equal(byIdBefore.get("m2")!.net, -300);

  const record: SettlementRecord = {
    id: "s1",
    fromMemberId: "m2",
    toMemberId: "m1",
    amount: 300,
    note: null,
    createdAt: new Date("2026-07-19"),
  };
  const settled = computeBalances(members, [e], [record]);
  const byId = new Map(settled.map((b) => [b.member.id, b]));
  // m2 paid down their debt to m1: both nets move toward zero by ₹300.
  assert.equal(byId.get("m2")!.net, 0);
  assert.equal(byId.get("m1")!.net, 300);
  assert.equal(computeSettlements(settled).length, 1);
});

test("settlement optimization: independent zero-sum groups beat naive full-set greedy", () => {
  const a: Member = { id: "a", name: "A", userId: null, role: "member" };
  const b: Member = { id: "b", name: "B", userId: null, role: "member" };
  const c: Member = { id: "c", name: "C", userId: null, role: "member" };
  const d: Member = { id: "d", name: "D", userId: null, role: "member" };
  const e: Member = { id: "e", name: "E", userId: null, role: "member" };
  // Scaled well beyond SETTLED_EPSILON (₹1) so no accidental near-zero
  // subset gets treated as settled by the epsilon tolerance.
  const balances: MemberBalance[] = [
    { member: a, paid: 0, share: 0, net: 100 },
    { member: b, paid: 0, share: 0, net: -40 },
    { member: c, paid: 0, share: 0, net: -60 },
    { member: d, paid: 0, share: 0, net: 90 },
    { member: e, paid: 0, share: 0, net: -90 },
  ];
  // {A,B,C} and {D,E} are each independently zero-sum, so the true minimum
  // is 2 + 1 = 3 transactions. Hand-simulating plain largest-vs-largest
  // greedy over the *unpartitioned* 5-person set (A100 vs E90, A10 vs C60,
  // D90 vs C50, D40 vs B40) produces 4 — this asserts the partitioned
  // result, proving the zero-sum-group pass actually improves on naive
  // greedy.
  const settlements = computeSettlements(balances);
  assert.equal(settlements.length, 3);
  assert.equal(
    settlements.reduce((sum, s) => sum + s.amount, 0),
    190,
  );
  for (const s of settlements) {
    assert.ok(!(s.from.id === "d" && s.to.id === "a"));
    assert.ok(!(s.from.id === "e" && s.to.id === "a"));
    assert.ok(!(s.from.id === "b" && s.to.id === "d"));
  }
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
