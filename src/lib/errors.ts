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
