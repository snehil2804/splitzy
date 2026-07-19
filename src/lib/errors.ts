/**
 * Postgres/PostgREST reports RLS and grant denials as "permission denied
 * for table X" (SQLSTATE 42501) — a fundamentally different situation from
 * a network failure: the request reached the server and was correctly
 * rejected because this account isn't a member of any visible trip yet.
 * Surfacing that as "check your connection" is actively misleading, so
 * `useTripData` classifies it into its own status instead of "error".
 */
export function isPermissionError(message: string): boolean {
  return /permission denied|row-level security|RLS/i.test(message);
}

/**
 * True for genuine transport failures (offline, DNS, aborted request) —
 * the only case where "check your connection" copy is honest. Browsers
 * throw these as `TypeError: Failed to fetch` / `NetworkError…` /
 * `Load failed` (Safari).
 */
export function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(
    message,
  );
}
