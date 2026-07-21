import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpiPaymentUri, maskUpiId, validateUpiId } from "../src/lib/upi";

test("default (no app argument) still produces the universal upi://pay scheme, unchanged", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 100,
    tripName: "Trip"
  });
  assert.match(uri, /^upi:\/\/pay\?/);
});

test("each app-specific scheme carries the exact same params as the generic one, just a different prefix", () => {
  const input = {
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 3167,
    tripName: "Dharamshala"
  };
  const generic = buildUpiPaymentUri(input, "generic");
  const genericQuery = generic.split("?")[1];

  for (const [app, prefix] of [
    ["gpay", "gpay://upi/pay?"],
    ["phonepe", "phonepe://pay?"],
    ["paytm", "paytmmp://pay?"],
    ["cred", "credpay://upi/pay?"],
  ] as const) {
    const uri = buildUpiPaymentUri(input, app);
    assert.ok(uri.startsWith(prefix), `expected ${app} URI to start with ${prefix}, got ${uri}`);
    assert.equal(uri.slice(prefix.length), genericQuery, `${app} params should match the generic scheme's params exactly`);
  }
});

test("an invalid recipient or non-positive amount is rejected the same way regardless of which app scheme is requested", () => {
  for (const app of ["generic", "gpay", "phonepe", "paytm", "cred"] as const) {
    assert.throws(() =>
      buildUpiPaymentUri(
        { recipientUpiId: "not-valid", recipientName: "X", amount: 10, tripName: "T", },
        app,
      ),
    );
    assert.throws(() =>
      buildUpiPaymentUri(
        { recipientUpiId: "x@ybl", recipientName: "X", amount: 0, tripName: "T", },
        app,
      ),
    );
  }
});

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
    tripName: "Dharamshala"
  });
  assert.match(uri, /[?&]am=3167\.00(&|$)/);
});

test("a fractional amount is preserved exactly, not rounded away", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 429.5,
    tripName: "Dharamshala"
  });
  assert.match(uri, /[?&]am=429\.50(&|$)/);
});

test("query-breaking characters in the payee name are stripped, never left to inject query syntax", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil & Co / Rai",
    amount: 100,
    tripName: "Trip",
  });
  assert.ok(!uri.includes("&Co"));
  assert.ok(!uri.includes("Snehil & Co"));
  assert.match(uri, /pn=Snehil%20Co%20Rai/);
});

test("the payment note is plain ASCII and includes the trip name", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 100,
    tripName: "Goa Trip 2026",
  });
  assert.match(uri, /tn=Splitzy%20Goa%20Trip%202026%20settlement/);
});

/**
 * The bug behind "you have exceeded your payment limit" (Google Pay) and
 * "UPI ID is invalid" (CRED) on real devices: `tr`/`mc` are merchant-flow
 * fields, and sending `tr` without `mc` to a personal VPA yields a payload
 * PSP apps reject behind misleading error messages.
 */
test("never emits the merchant-only tr or mc fields — this is a P2P payment", () => {
  for (const app of ["generic", "gpay", "phonepe", "paytm", "cred"] as const) {
    const uri = buildUpiPaymentUri(
      {
        recipientUpiId: "snehil@ybl",
        recipientName: "Snehil",
        amount: 3167,
        tripName: "Dharamshala",
      },
      app,
    );
    assert.ok(!/[?&]tr=/.test(uri), `${app} URI must not contain tr: ${uri}`);
    assert.ok(!/[?&]mc=/.test(uri), `${app} URI must not contain mc: ${uri}`);
  }
});

test("emits exactly the five P2P fields, in NPCI's documented order", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 250,
    tripName: "Trip",
  });
  const keys = uri
    .split("?")[1]
    .split("&")
    .map((pair) => pair.split("=")[0]);
  assert.deepEqual(keys, ["pa", "pn", "am", "cu", "tn"]);
});

test("a non-ASCII trip name can never leak into the note", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil@ybl",
    recipientName: "Snehil",
    amount: 50,
    tripName: "गोवा · Trip™",
  });
  const note = decodeURIComponent(uri.split("tn=")[1].split("&")[0]);
  assert.match(note, /^[A-Za-z0-9 ]+$/, `note must be plain ASCII, got: ${note}`);
  assert.ok(note.length <= 40);
});

test("cu is always INR and pa carries the exact recipient UPI ID, unencoded characters intact", () => {
  const uri = buildUpiPaymentUri({
    recipientUpiId: "snehil.rai@okhdfcbank",
    recipientName: "Snehil",
    amount: 50,
    tripName: "Trip",
  });
  assert.match(uri, /[?&]cu=INR(&|$)/);
  assert.match(uri, /pa=snehil\.rai%40okhdfcbank/);
});

test("a zero or negative amount is rejected rather than silently encoded", () => {
  assert.throws(() =>
    buildUpiPaymentUri({
      recipientUpiId: "snehil@ybl",
      recipientName: "Snehil",
      amount: 0,
      tripName: "Trip"
    }),
  );
  assert.throws(() =>
    buildUpiPaymentUri({
      recipientUpiId: "snehil@ybl",
      recipientName: "Snehil",
      amount: -5,
      tripName: "Trip"
    }),
  );
});

test("a malformed recipient UPI ID is rejected rather than silently encoded into a broken link", () => {
  assert.throws(() =>
    buildUpiPaymentUri({
      recipientUpiId: "not-a-upi-id",
      recipientName: "Snehil",
      amount: 50,
      tripName: "Trip"
    }),
  );
});

test("buildUpiPaymentUri only ever reflects the exact fields it was given — there is no override/merge path a caller could use to substitute a different recipient or amount", () => {
  const input = {
    recipientUpiId: "trusted@ybl",
    recipientName: "Trusted Person",
    amount: 250,
    tripName: "Trip"
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
