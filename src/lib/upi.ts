/**
 * UPI ID validation, masking, and payment-URI construction. Pure functions
 * only — no Supabase, no DOM. The regex here matches the server-side CHECK
 * constraint on `members.upi_id` exactly (see migration
 * `20260722000000_member_upi_id.sql`); this is a client-side pre-check for
 * a fast error message, never the actual security boundary.
 */

// Bound kept comfortably under PostgreSQL's regex engine limit (255) on
// {n,m} repetition counts — the matching server-side CHECK constraint threw
// "invalid regular expression: invalid repetition count(s)" at {2,256}.
// Real UPI handles are nowhere near even this length; 100 is generous.
const UPI_ID_PATTERN = /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z]{2,64}$/;

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
}

/**
 * `tn` (transaction note) is passed straight through to the payer's bank and
 * the PSP app, and those validators are far stricter than the URI encoding
 * suggests — non-ASCII characters in particular are a common cause of
 * rejected payloads. Reduced to plain ASCII letters, digits and spaces, and
 * capped well under the ~50-character limit PSPs commonly enforce.
 */
function sanitizeNote(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}

/**
 * "generic" is the universal NPCI `upi://pay` scheme every UPI app on the
 * device registers for — the reliable default. The rest are best-effort,
 * commonly-used branded schemes for launching one *specific* app directly,
 * NOT confirmed against first-party documentation the way the generic
 * scheme and Google's own merchant-flow docs were (see the plan notes /
 * CHANGELOG entry on why a `gpay://` merchant link isn't used here — this
 * omits `mc` entirely, since Splitzy has no merchant registration to put
 * there). They may not work on every device; callers must always offer the
 * generic link and Copy actions alongside them, never only these.
 */
export type UpiAppId = "generic" | "gpay" | "phonepe" | "paytm" | "cred";

const UPI_APP_SCHEMES: Record<UpiAppId, string> = {
  generic: "upi://pay",
  gpay: "gpay://upi/pay",
  phonepe: "phonepe://pay",
  paytm: "paytmmp://pay",
  cred: "credpay://upi/pay",
};

export const UPI_APP_LABELS: Record<Exclude<UpiAppId, "generic">, string> = {
  gpay: "Google Pay",
  phonepe: "PhonePe",
  paytm: "Paytm",
  cred: "CRED",
};

/**
 * Builds a UPI payment deep link for the given app (default: the universal
 * scheme). Every value is taken only from the fields on this object and run
 * through `encodeURIComponent` — there is no merge/override path, so a
 * caller cannot smuggle in a different recipient or amount than what was
 * passed, regardless of which app's scheme is requested.
 *
 * Deliberately emits ONLY the five person-to-person fields: `pa`, `pn`,
 * `am`, `cu`, `tn`. It must never send `tr` (transaction reference) or `mc`
 * (merchant code) — NPCI mandates those together for *merchant* (P2M)
 * transactions, and sending `tr` without `mc` while paying a personal VPA
 * produces a payload PSP apps reject inconsistently: Google Pay reports
 * "you have exceeded your payment limit" (its generic invalid-payload
 * fallback, which is why it fired even for ₹1) and CRED reports "UPI ID is
 * invalid". Both were misleading — the UPI ID and the limit were always
 * fine; the payload wasn't.
 */
export function buildUpiPaymentUri(
  { recipientUpiId, recipientName, amount, tripName }: UpiPaymentUriInput,
  app: UpiAppId = "generic",
): string {
  if (!(amount > 0)) {
    throw new Error("Amount must be greater than zero.");
  }
  if (!UPI_ID_PATTERN.test(recipientUpiId)) {
    throw new Error("Recipient does not have a valid UPI ID.");
  }

  const note = sanitizeNote(`Splitzy ${tripName} settlement`);
  const params: [string, string][] = [
    ["pa", recipientUpiId],
    ["pn", sanitizeNote(recipientName) || "Splitzy payee"],
    ["am", amount.toFixed(2)],
    ["cu", "INR"],
    ["tn", note],
  ];
  // Encoded by hand (not URLSearchParams) so spaces become %20, not "+" —
  // the more universally compatible form across UPI apps' query parsing.
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `${UPI_APP_SCHEMES[app]}?${query}`;
}
