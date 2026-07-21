"use client";

import { useState } from "react";

/**
 * TEMPORARY diagnostic page — not linked from anywhere, preview-only, and
 * removed before this branch merges.
 *
 * Real payments fail on-device with misleading errors ("limit exceeded",
 * "UPI ID is invalid") while paying the same person inside the PSP app
 * works. The stored UPI ID is byte-perfect ASCII and the payload is now
 * exactly NPCI's five P2P fields, so the next question is which *specific
 * field* the PSP app is objecting to. This walks the payload down from a
 * full link to the barest possible one so we can see exactly where it
 * starts working.
 *
 * Nothing here is stored or sent anywhere — every link is built in the
 * browser from what you type.
 */
export default function UpiDebugPage() {
  const [upiId, setUpiId] = useState("");
  const [amount, setAmount] = useState("1.00");

  const pa = encodeURIComponent(upiId.trim());
  const am = encodeURIComponent(amount.trim());

  const variants: { label: string; hint: string; uri: string }[] = upiId.trim()
    ? [
        {
          label: "A · Full payload (what Splitzy sends now)",
          hint: "pa + pn + am + cu + tn",
          uri: `upi://pay?pa=${pa}&pn=Test%20Payee&am=${am}&cu=INR&tn=Splitzy%20test`,
        },
        {
          label: "B · No note",
          hint: "pa + pn + am + cu",
          uri: `upi://pay?pa=${pa}&pn=Test%20Payee&am=${am}&cu=INR`,
        },
        {
          label: "C · No payee name",
          hint: "pa + am + cu",
          uri: `upi://pay?pa=${pa}&am=${am}&cu=INR`,
        },
        {
          label: "D · No amount (you type it in the app)",
          hint: "pa + pn — the key test",
          uri: `upi://pay?pa=${pa}&pn=Test%20Payee`,
        },
        {
          label: "E · Payee only, barest possible link",
          hint: "pa",
          uri: `upi://pay?pa=${pa}`,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight">UPI link diagnostic</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Temporary test page. Try each link top to bottom and note which ones open the app,
          and which actually let the payment go through.
        </p>
      </header>

      <section className="glass space-y-3 rounded-3xl p-5">
        <label className="block text-sm font-semibold">
          Payee UPI ID
          <input
            type="text"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="name@bank"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2 min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="block text-sm font-semibold">
          Amount
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none focus:border-brand"
          />
        </label>
        <p className="text-xs text-ink-faint">
          Use ₹1 and a real payee. Nothing is saved or sent — links are built in your browser.
        </p>
      </section>

      {variants.map((v) => (
        <section key={v.label} className="glass space-y-2 rounded-3xl p-5">
          <p className="text-sm font-semibold">{v.label}</p>
          <p className="text-xs text-ink-faint">{v.hint}</p>
          <p className="break-all rounded-xl bg-line/60 px-3 py-2 font-mono text-[11px] text-ink-muted">
            {v.uri}
          </p>
          <a
            href={v.uri}
            className="tap flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand text-sm font-semibold text-white"
          >
            Open this link
          </a>
        </section>
      ))}
    </div>
  );
}
