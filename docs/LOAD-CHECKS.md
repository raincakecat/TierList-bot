# Repeatable local load checks

Run `npm ci`, `npm run build`, then `node scripts/load-check.mjs`. An optional output filename saves JSON, for example `node scripts/load-check.mjs release/load-report.json`. The script creates a disposable local SQLite database and cleans it up afterward. It does not connect to Discord or a remote database.

On October 13, 2026, Windows with Node v24.18.0 passed:

- 5,000 linked player records and 5,000 historical completed jobs.
- 1,000 queued players, displayed as eight pages of intact mentions.
- Ten concurrent reservations selecting ten distinct players in FIFO order.
- Approximately 1.61 MB of serialized saved state.
- Seed: 34 ms; concurrent reservations: 746 ms; read: 9 ms in this run. Timings vary with machine and load and are measurements, not service guarantees.

The regression suite also paginates 2,200 simulated ticket messages containing about 8.8 MB of text. It verifies the supported single-file archive limit retains the channel rather than deleting unarchived evidence.

GitHub Actions runs the suite, local load check, ZIP integrity check, and fresh runtime installation on Windows and Linux. Workflow results are the authority for those runs; a passing local Windows check does not establish a Linux pass.

Unresolved limits: remote database latency/RLS, Discord rate limits and permissions, large lists fetching many members, very long transcript memory usage, and growing jobs/audit/history retention. This state-document implementation needs measurement before scaling to a large active community. Historical-state pruning is not introduced in this release.
