import assert from "node:assert/strict";
import { test } from "node:test";
import { explainSettlement } from "../src/components/SettlementList";
import type { Member, MemberBalance, Settlement } from "../src/lib/types";

const snehil: Member = { id: "m1", name: "Snehil", userId: "u1", role: "owner" };
const shruti: Member = { id: "m2", name: "Shruti", userId: null, role: "member" };
const anshul: Member = { id: "m3", name: "Anshul", userId: null, role: "member" };
const snehiltest: Member = { id: "m4", name: "Snehiltest", userId: "u4", role: "member" };

// Mirrors the real Dharamshala trip's computeSettlements() output.
const settlements: Settlement[] = [
  { from: anshul, to: shruti, amount: 429 },
  { from: snehiltest, to: shruti, amount: 129 },
  { from: snehiltest, to: snehil, amount: 86 },
];

// The real (unrounded) per-member balances behind that settlement list.
const balances: MemberBalance[] = [
  { member: snehil, paid: 900, share: 514.28, net: 85.72 },
  { member: shruti, paid: 1500, share: 942.86, net: 557.14 },
  { member: anshul, paid: 0, share: 728.57, net: -428.57 },
  { member: snehiltest, paid: 0, share: 214.29, net: -214.29 },
];

test("a debtor with a single settlement gets a short, self-contained explanation", () => {
  const text = explainSettlement(settlements[0], settlements);
  assert.match(text, /Anshul/);
  assert.match(text, /entire remaining balance/);
});

test("a debtor split across multiple creditors explains each piece in order", () => {
  const text = explainSettlement(settlements[1], settlements);
  assert.match(text, /Snehiltest owes ₹215 overall/);
  assert.match(text, /₹129 settles Shruti's remaining balance/);
  assert.match(text, /The remaining ₹86 settles Snehil's remaining balance/);
  assert.match(text, /minimizes the total number of transactions/);
});

test("the explanation for the second piece of a split debt matches the first", () => {
  const text = explainSettlement(settlements[2], settlements);
  assert.match(text, /Snehiltest owes ₹215 overall/);
  assert.match(text, /₹129 settles Shruti's remaining balance/);
  assert.match(text, /The remaining ₹86 settles Snehil's remaining balance/);
});

test("with real balances supplied, the headline total uses full paisa precision", () => {
  const text = explainSettlement(settlements[1], settlements, balances);
  assert.match(text, /Snehiltest owes ₹214\.29 overall/);
  assert.match(text, /₹129 settles Shruti's remaining balance/);
  assert.match(text, /The remaining ₹86 settles Snehil's remaining balance/);
});

test("without balances, the headline falls back to summing the rounded settlement pieces", () => {
  const text = explainSettlement(settlements[1], settlements);
  assert.match(text, /Snehiltest owes ₹215 overall/);
});

test("three-way split debt labels the middle piece as 'Another'", () => {
  const debtor: Member = { id: "m5", name: "Debtor", userId: null, role: "member" };
  const a: Member = { id: "m6", name: "A", userId: null, role: "member" };
  const b: Member = { id: "m7", name: "B", userId: null, role: "member" };
  const c: Member = { id: "m8", name: "C", userId: null, role: "member" };
  const threeWay: Settlement[] = [
    { from: debtor, to: a, amount: 100 },
    { from: debtor, to: b, amount: 50 },
    { from: debtor, to: c, amount: 25 },
  ];
  const text = explainSettlement(threeWay[1], threeWay);
  assert.match(text, /₹100 settles A's remaining balance/);
  assert.match(text, /Another ₹50 settles B's remaining balance/);
  assert.match(text, /The remaining ₹25 settles C's remaining balance/);
});
