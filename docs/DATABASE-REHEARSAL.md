# Dedicated database rehearsal

SQLite is exercised locally. PostgreSQL contract tests use an emulator and Supabase contract tests use a mocked API. They do not prove a real project's permissions, connectivity, TLS, or RLS. Use a disposable dedicated database/project first.

## PostgreSQL

Create a test database and a server account allowed to create/use the `crystal` schema. Use verified TLS for a remote host. On a separate test installation, set `database.backend` to `postgresql` and supply that test database's `DATABASE_URL` privately. Start and stop the test bot to confirm initialization and restart persistence. Never point rehearsals at community production state.

## Supabase

Create a dedicated test project, apply `sql/supabase.sql`, and use its URL/service_role credentials on the private test host. Confirm the table has RLS enabled and browser anon/authenticated clients cannot read, insert, or update state or execute `crystal_commit`. Verify the server role can perform all intended operations. Test negative permissions with disposable credentials; do not share raw keys or database errors in public reports.

## Scenarios for either backend

1. First startup creates the expected empty state without overwriting an existing row; second startup preserves it.
2. Two independent connections attempt changes at the same revision. Only one wins; the loser retries without losing another update. Concurrent verification must maintain UUID uniqueness, and reservation must not duplicate an active test.
3. Stop/restart with pending jobs and working leases. Check retry checkpoints and exactly-once completion credit.
4. Export, validate, restore a disposable snapshot in maintenance, then check player links, opening ranks, restrictions, job status, and process lease.
5. Transfer from the test backend to a separate empty backend. Compare restored state, keep source maintenance enabled, and start only one destination process after switching configuration. A nonempty destination must be rejected.
6. Interrupt connectivity during read, CAS, and archival checkpoint updates. Recovery must retain saved work, sanitize user-visible errors, and stop operating when the process lease cannot be renewed.
7. Re-run realistic state-volume checks against the dedicated backend. Measure latency and storage growth; the local SQLite figures do not predict remote throughput.

Record provider, Node version, test data sizes, outcomes, and timings privately. None of these live remote checks has been performed in the delivered candidate. Use the integration test examples in `test/adapters.test.ts` as contract references, not as evidence of a live server pass.
