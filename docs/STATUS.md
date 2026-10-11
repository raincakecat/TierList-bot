# Implementation and release checks

## Implemented

- TypeScript build, compiled runtime, pinned dependencies, generic JSON configuration, validation, role permission groups, and setup preview/confirmation.
- SQLite, PostgreSQL, and Supabase persistence adapters with atomic revision changes and process lease.
- Verification, regional roles/access, FIFO queues, tester sessions, normal/high tickets, opening rank snapshot, evaluation progression, results/reactions, list updates, and participant tools.
- Support types, close controls, ticket registration/conversion, overflow, restrictions, deadlines, maintenance, rank-role reconciliation, departure/rejoin handling, stats and quota report scheduling.
- Durable jobs, Markdown/image archival, safe deletion delay, retention cleanup, daily backups, restore/transfer, and standardized one-time migration with partial imports and Bot Review correction controls.

## Verified locally

See the latest test output. Tests use real local SQLite and in-memory state; mock transport tests do not substitute for an actual Discord server. TypeScript compilation checks the pinned Discord and Supabase interfaces.

## Required before calling the build production-ready

- Run real Supabase/PostgreSQL integration tests with a dedicated test database. Confirm SQL grants/RLS, revision conflicts, restart recovery, export/restore, and transfers.
- Rehearse Discord setup and every command/button in an isolated server, including role hierarchy, sensitive ticket visibility, expired confirmations, category overflow, and archive failure recovery.
- Verify packaged installation on clean Linux and macOS hosts; this workspace runs Windows.
- Load-test community-sized state and long transcripts; measure backend document growth and job/history cleanup requirements.
- Rehearse staff role changes, member departure during ticket creation, and configuration changes while jobs are pending.
- Review the final command reference against registered command names and the approved specification.

No live bot deployment or production migration has been performed. Do not stop an existing bot until rehearsal passes.
