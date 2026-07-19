const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,234 for whole amounts, ₹1,234.50 when paise matter. */
export function formatINR(amount: number): string {
  const paise = Math.round(amount * 100);
  return paise % 100 === 0
    ? inrWhole.format(paise / 100)
    : inrPrecise.format(paise / 100);
}

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

/** "Today", "Yesterday", or "Sat, 19 Jul". */
export function formatDayLabel(date: Date): string {
  const now = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return dayFormat.format(date);
}

/** Stable key for grouping expenses by calendar day. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
