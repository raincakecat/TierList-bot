# Implementation and release checks

## Implemented

- TypeScript build, compiled runtime, pinned dependencies, generic JSON configuration, validation, role permission groups, and setup preview/confirmation.
- SQLite, PostgreSQL, and Supabase persistence adapters with atomic revision changes and process lease.
- Verification, regional roles/access, FIFO queues, tester sessions, normal/high tickets, opening rank snapshot, evaluation progression, results/reactions, list updates, and participant tools.
- Support types, close controls, ticket registration/conversion, overflow, restrictions, deadlines, maintenance, rank-role reconciliation, departure/rejoin handling, stats and quota report scheduling.
- Durable jobs, Markdown/image archival, safe deletion delay, retention cleanup, daily backups, restore/transfer, and standardized one-time migration with partial imports and Bot Review correction controls.
- Exclusive restore/transfer fencing with lease renewal; line-safe queue/list pagination and removal of stale pages; historic archive image cleanup.
- Private `/health`, immediate Already Verified embeds, and an operator-bound Discord setup wizard with draft review/confirmation.
- GitHub Actions for Windows/Linux build, tests, local load checks and clean package installation.
- Optional staff LOA portal/roster, admin approval/denial, timed role and durable notifications, withdrawal/early return, saved leave history and monthly quota exemption.

## Verified locally

61 automated tests passed on Windows with Node v24.18.0. Tests use real local SQLite and in-memory state; mock transport tests do not substitute for an actual Discord server. TypeScript compilation checks the pinned Discord and Supabase interfaces. Recovery races/timeouts, wizard authorization/confirmation, health privacy/failure output, long transcripts, panel cleanup and LOA lifecycle/notifications/quota boundaries are covered. See LOAD-CHECKS.md for the measured 5,000-player load run.

## Required before calling the build production-ready

- Run real Supabase/PostgreSQL integration tests with a dedicated test database. Confirm SQL grants/RLS, revision conflicts, restart recovery, export/restore, and transfers.
- Rehearse Discord setup and every command/button in an isolated server, including role hierarchy, sensitive ticket visibility, expired confirmations, category overflow, and archive failure recovery.
- Verify packaged installation on clean Linux and macOS hosts; this workspace runs Windows.
- Extend local volume tests to real Discord/remote backends; measure document growth and job/history cleanup requirements.
- Rehearse staff role changes, member departure during ticket creation, and configuration changes while jobs are pending.
- Review the final command reference against registered command names and the approved specification.

No live bot deployment or production migration has been performed. Do not stop an existing bot until rehearsal passes.

Use LIVE-REHEARSAL.md and DATABASE-REHEARSAL.md for the remaining live checks. CI results should be reviewed separately from the local test results above.
