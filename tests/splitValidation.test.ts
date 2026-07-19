import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSplit } from "../src/lib/splitValidation";

const participantIds = ["m1", "m2", "m3"];

test("equal split never requires values and never returns splits", () => {
  const result = validateSplit("equal", participantIds, {}, 900);
  assert.equal(result.error, null);
  assert.equal(result.splits, null);
});

test("exact split: matching amounts pass and are returned as splits", () => {
  const result = validateSplit(
    "exact",
    participantIds,
    { m1: "300", m2: "300", m3: "300" },
    900,
  );
  assert.equal(result.error, null);
  assert.deepEqual(result.splits, [
    { memberId: "m1", value: 300 },
    { memberId: "m2", value: 300 },
    { memberId: "m3", value: 300 },
  ]);
});

test("exact split: amounts that don't add up to the total are rejected", () => {
  const result = validateSplit(
    "exact",
    participantIds,
    { m1: "300", m2: "300", m3: "250" },
    900,
  );
  assert.match(result.error ?? "", /add up to/);
  assert.equal(result.splits, null);
});

test("exact split: within a paisa of the total is accepted (rounding tolerance)", () => {
  const result = validateSplit(
    "exact",
    participantIds,
    { m1: "300", m2: "300", m3: "300.009" },
    900,
  );
  assert.equal(result.error, null);
});

test("percentage split: must add up to 100", () => {
  const bad = validateSplit(
    "percentage",
    participantIds,
    { m1: "50", m2: "30", m3: "10" },
    900,
  );
  assert.match(bad.error ?? "", /100/);

  const good = validateSplit(
    "percentage",
    participantIds,
    { m1: "50", m2: "30", m3: "20" },
    900,
  );
  assert.equal(good.error, null);
  assert.deepEqual(good.splits, [
    { memberId: "m1", value: 50 },
    { memberId: "m2", value: 30 },
    { memberId: "m3", value: 20 },
  ]);
});

test("shares split: rejects zero or negative share counts", () => {
  const zero = validateSplit(
    "shares",
    participantIds,
    { m1: "1", m2: "1", m3: "0" },
    900,
  );
  assert.match(zero.error ?? "", /positive value/);

  const negative = validateSplit(
    "shares",
    participantIds,
    { m1: "1", m2: "-2", m3: "1" },
    900,
  );
  assert.match(negative.error ?? "", /positive value/);
});

test("shares split: any positive values pass (proportion computed server-side)", () => {
  const result = validateSplit(
    "shares",
    participantIds,
    { m1: "1", m2: "2", m3: "3" },
    900,
  );
  assert.equal(result.error, null);
  assert.deepEqual(result.splits, [
    { memberId: "m1", value: 1 },
    { memberId: "m2", value: 2 },
    { memberId: "m3", value: 3 },
  ]);
});

test("non-equal splits: a missing value for any participant is rejected", () => {
  const result = validateSplit(
    "exact",
    participantIds,
    { m1: "300", m2: "300" },
    900,
  );
  assert.match(result.error ?? "", /positive value/);
});

test("non-equal splits: a blank or non-numeric value is rejected", () => {
  const result = validateSplit(
    "percentage",
    participantIds,
    { m1: "50", m2: "abc", m3: "20" },
    900,
  );
  assert.match(result.error ?? "", /positive value/);
});
