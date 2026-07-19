/**
 * Picks an emoji for an expense by keyword-matching its description (the
 * backend has no category column). Order matters: more specific patterns
 * come first.
 */

const KEYWORD_EMOJI: Array<[RegExp, string]> = [
  [/\b(breakfast|brunch|dosa|idli|paratha|chai|coffee|cafe)\b/i, "☕️"],
  [/\b(lunch|dinner|thali|biryani|pizza|burger|momos|restaurant|food|meal|snack)\b/i, "🍕"],
  [/\b(beer|drinks?|bar|wine|cocktail)\b/i, "🍻"],
  [/\b(ice\s?cream|dessert|cake|sweet)\b/i, "🍨"],
  [/\b(grocer(y|ies)|supermarket|mart)\b/i, "🛒"],
  [/\b(uber|ola|cab|taxi|auto|rickshaw)\b/i, "🚕"],
  [/\b(train|irctc|railway|metro)\b/i, "🚆"],
  [/\b(flight|airline|indigo|airport)\b/i, "✈️"],
  [/\b(bus)\b/i, "🚌"],
  [/\b(petrol|diesel|fuel|gas)\b/i, "⛽️"],
  [/\b(hotel|hostel|airbnb|oyo|resort|stay|room)\b/i, "🏨"],
  [/\b(ticket|entry|museum|fort|palace|park|show|movie|cinema)\b/i, "🎟️"],
  [/\b(trek|hike|adventure|rafting|paragliding|scuba)\b/i, "🏔️"],
  [/\b(beach)\b/i, "🏖️"],
  [/\b(shopping|clothes|souvenir|gift|market)\b/i, "🛍️"],
  [/\b(medicine|pharmacy|doctor|hospital)\b/i, "💊"],
  [/\b(recharge|sim|wifi|internet)\b/i, "📶"],
  [/\b(tip|donation)\b/i, "💝"],
];

export function expenseEmoji(description: string): string {
  for (const [pattern, emoji] of KEYWORD_EMOJI) {
    if (pattern.test(description)) return emoji;
  }
  return "💸";
}
