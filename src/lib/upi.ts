/**
 * UPI ID validation, masking, and payment-URI construction. Pure functions
 * only — no Supabase, no DOM. The regex here matches the server-side CHECK
 * constraint on `members.upi_id` exactly (see migration
 * `20260722000000_member_upi_id.sql`); this is a client-side pre-check for
 * a fast error message, never the actual security boundary.
 */

const UPI_ID_PATTERN = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export interface UpiIdValidationResult {
  valid: boolean;
  /** Whitespace-trimmed input, case and characters otherwise untouched. */
  normalized: string;
  error?: string;
}

/**
 * Trims surrounding whitespace only — never changes case or characters, so
 * the handle the user actually typed is what gets saved. An empty string
 * (after trimming) is treated as "clear the field", not an invalid UPI ID;
 * callers that require a value should check for that themselves.
 */
export function validateUpiId(raw: string): UpiIdValidationResult {
  const normalized = raw.trim();
  if (normalized === "") {
    return { valid: true, normalized: "" };
  }
  if (!UPI_ID_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Enter a valid UPI ID, like name@bank.",
    };
  }
  return { valid: true, normalized };
}

/**
 * Masks the handle portion (before @) for display, keeping the first and
 * last two characters and the bank/PSP suffix visible — enough for the
 * payer to sanity-check they're paying the right provider without showing
 * the full handle on screen outside payment-related contexts.
 */
export function maskUpiId(upiId: string): string {
  const at = upiId.indexOf("@");
  if (at <= 0) return upiId;
  const handle = upiId.slice(0, at);
  const suffix = upiId.slice(at);
  if (handle.length <= 4) {
    return `${handle[0]}${"*".repeat(Math.max(handle.length - 1, 1))}${suffix}`;
  }
  const visible = 2;
  const masked = "*".repeat(Math.min(handle.length - visible * 2, 6));
  return `${handle.slice(0, visible)}${masked}${handle.slice(-visible)}${suffix}`;
}

export interface UpiPaymentUriInput {
  /** The stored, already-validated recipient UPI ID — never client-editable at this point. */
  recipientUpiId: string;
  recipientName: string;
  /** A positive amount in rupees; formatted to exactly 2 decimals for `am`. */
  amount: number;
  tripName: string;
  /** Client-generated unique reference for this payment attempt (`tr`). */
  reference: string;
}

/**
 * Builds a standard `upi://pay` deep link (the universal NPCI scheme every
 * UPI app registers for, including Google Pay — see CLAUDE.md/plan notes on
 * why this app does not use a branded `gpay://` merchant scheme). Every
 * value is taken only from the fields on this object and run through
 * `encodeURIComponent` — there is no merge/override path, so a caller
 * cannot smuggle in a different recipient or amount than what was passed.
 */
export function buildUpiPaymentUri({
  recipientUpiId,
  recipientName,
  amount,
  tripName,
  reference,
}: UpiPaymentUriInput): string {
  if (!(amount > 0)) {
    throw new Error("Amount must be greater than zero.");
  }
  if (!UPI_ID_PATTERN.test(recipientUpiId)) {
    throw new Error("Recipient does not have a valid UPI ID.");
  }

  const note = `Splitzy · ${tripName} settlement`;
  const params: [string, string][] = [
    ["pa", recipientUpiId],
    ["pn", recipientName],
    ["am", amount.toFixed(2)],
    ["cu", "INR"],
    ["tn", note],
    ["tr", reference],
  ];
  // Encoded by hand (not URLSearchParams) so spaces become %20, not "+" —
  // the more universally compatible form across UPI apps' query parsing.
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `upi://pay?${query}`;
}
