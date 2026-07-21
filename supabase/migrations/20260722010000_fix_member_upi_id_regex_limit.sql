-- Fixes a real bug in members_upi_id_format (20260722000000_member_upi_id.sql):
-- its {2,256} repetition count exceeds PostgreSQL's regex engine limit on
-- bounded repetition ({n,m} caps out at 255), so the constraint threw
-- "invalid regular expression: invalid repetition count(s)" on every actual
-- write attempt — reproduced directly: `select 'a' ~ '^a{2,256}$'` fails,
-- `{2,255}` succeeds. Never caught earlier because the prior migration's own
-- verification checked the constraint existed, not that a real value could
-- pass through it.
--
-- Additive/corrective only — drops and recreates one CHECK constraint,
-- nothing else. No data loss: upi_id is brand new and unused so far.

alter table public.members drop constraint members_upi_id_format;

alter table public.members add constraint members_upi_id_format
  check (upi_id is null or upi_id ~ '^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z]{2,64}$');
