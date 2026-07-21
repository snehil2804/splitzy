import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpiPaymentUri, maskUpiId, validateUpiId } from "../src/lib/upi";

test("a well-formed UPI ID passes validation, trimmed but otherwise untouched", () => {
  const result = validateUpiId("  Snehil.Rai_92@ybl  ");
  assert.equal(result.valid, true);
  assert.equal(result.normalized, "Snehil.Rai_92@ybl");
});

test("an empty (or whitespace-only) input is treated as 'clear the field', not invalid", () => {
  const result = validateUpiId("   ");
  assert.equal(result.valid, true);
  assert.equal(result.normalized, "");
});

test("invalid UPI input is rejected cleanly with a helpful message", () => {
  for (const bad of ["not-a-upi-id", "@ybl", "name@", "name@1", "name"]) {
    const result = validateUpiId(bad);
    assert.equal(result.valid, false, `expected "${bad}" to be invalid`);
    assert.match(result.error ?? "", /valid UPI ID/i);
  }
});

test("maskUpiId keeps the bank suffix and the ends of a long handle visible, hides the middle", () => {
  const masked = maskUpiId("snehilrai92@ybl");
  assert.match(masked, /^sn\*+92@ybl$/);
  assert.ok(!masked.includes("snehilrai92"));
});

test("maskUpiId still masks something for a very short handle rather than showing it in full", () => {
  const masked = maskUpiId("ab@ybl");
  assert.notEqual(masked, "ab@ybl");
  assert.match(masked, /@ybl$/);
});

test("correct amount is encoded into the UPI URI with exactly two decimal places", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 3167,
    tripName: "Dharamshala",
    reference: "ref-1",
  });
  assert.match(uri, /[?&]am=3167\.00(&|$)/);
});

test("a fractional amount is preserved exactly, not rounded away", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 429.5,
    tripName: "Dharamshala",
    reference: "ref-2",
  });
  assert.match(uri, /[?&]am=429\.50(&|$)/);
});

test("recipient UPI ID and name are safely percent-encoded, never left to inject query syntax", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil & Co / Rai",
    amount: 100,
    tripName: "Trip",
    reference: "ref-3",
  });
  assert.match(uri, /pn=Snehil%20%26%20Co%20%2F%20Rai/);
  assert.ok(!uri.includes("Snehil & Co"));
});

test("the payment note is URL-encoded and includes the trip name", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 100,
    tripName: "Goa Trip 2026",
    reference: "ref-4",
  });
  assert.match(uri, /tn=Splitzy%20%C2%B7%20Goa%20Trip%202026%20settlement/);
});

test("cu is always INR and pa carries the exact recipient UPI ID, unencoded characters intact", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil.rai@okhdfcbank",
    recipientName: "Snehil",
    amount: 50,
    tripName: "Trip",
    reference: "ref-5",
  });
  assert.match(uri, /[?&]cu=INR(&|$)/);
  assert.match(uri, /pa=snehil\.rai%40okhdfcbank/);
});

test("the reference (tr) passed in is the one that appears in the URI, verbatim", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 50,
    tripName: "Trip",
    reference: "client-generated-uuid-123",
  });
  assert.match(uri, /tr=client-generated-uuid-123(&|$)/);
});

test("a zero or negative amount is rejected rather than silently encoded", () => {
  assert.throws(() =>
    buildUpiPaymentUri({
      recipientUpiId: "snehil@ybl",
      recipientName: "Snehil",
      amount: 0,
      tripName: "Trip",
      reference: "ref-6",
    }),
  );
  assert.throws(() =>
    buildUpiPaymentUri({
      recipientUpiId: "snehil@ybl",
      recipientName: "Snehil",
      amount: -5,
      tripName: "Trip",
      reference: "ref-7",
    }),
  );
});

test("a malformed recipient UPI ID is rejected rather than silently encoded into a broken link", () => {
  assert.throws(() =>
    buildUpiPaymentUri({
      recipientUpiId: "not-a-upi-id",
      recipientName: "Snehil",
      amount: 50,
      tripName: "Trip",
      reference: "ref-8",
    }),
  );
});

test("buildUpiPaymentUri only ever reflects the exact fields it was given — there is no override/merge path a caller could use to substitute a different recipient or amount", () => {
  const input = {
    recipientUpiId: "trusted@ybl",
    recipientName: "Trusted Person",
    amount: 250,
    tripName: "Trip",
    reference: "ref-9",
  };
  const uri = buildUpiPaymentUri(input);
  // Same call, same inputs, must be byte-identical — nothing hidden mutates
  // the output based on ambient/global state.
  const uriAgain = buildUpiPaymentUri({ ...input });
  assert.equal(uri, uriAgain);
  assert.match(uri, /pa=trusted%40ybl/);
  assert.match(uri, /am=250\.00/);
  assert.ok(!uri.includes("untrusted"));
});
