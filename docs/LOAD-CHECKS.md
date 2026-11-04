# Repeatable local load checks

Run `npm ci`, `npm run build`, then `node scripts/load-check.mjs`. An optional output filename saves JSON, for example `node scripts/load-check.mjs release/load-report.json`. The script creates a disposable local SQLite database and cleans it up afterward. It does not connect to Discord or a remote database.

On October 13, 2026, Windows with Node v24.18.0 passed:

- 5,000 linked player records and 5,000 historical completed jobs.
- 1,000 queued players, displayed as eight pages of intact mentions.
- Ten concurrent reservations selecting ten distinct players in FIFO order.
- Approximately 1.61 MB of serialized saved state.
- Seed: 34 ms; concurrent reservations: 746 ms; read: 9 ms in this run. Timings vary with machine and load and are measurements, not service guarantees.

The regression suite paginates 2,200 simulated ticket messages containing about 8.8 MB of text. Current multipart archival uploads two numbered transcript parts and retains the channel until all parts are saved and the safety delay passes. The original single-file limit has been removed.

GitHub Actions runs the suite, local load check, ZIP integrity check, and fresh runtime installation on Windows and Linux. Workflow results are the authority for those runs; a passing local Windows check does not establish a Linux pass.

Unresolved limits: remote database latency/RLS, Discord rate limits and permissions, large lists fetching many members, very long transcript memory usage, and growing jobs/audit/history retention. This state-document implementation needs measurement before scaling to a large active community. Historical-state pruning is not introduced in this release.


## Private VM response work — October 24, 2026
The home VM showed low CPU load and no pending/retrying job backlog. The state snapshot was about 657 KB with 1,009 completed jobs. Eight consecutive reads using the prior adapter took 549.6, 285.3, 181.9, 176.2, 252.1, 196.9, 191.3, and 182.2 ms. With the isolated 250ms snapshot cache, the cold read took 199.5 ms and seven immediate warm reads took 4.0, 6.2, 3.8, 4.1, 4.1, 4.0, and 4.3 ms. These are read-only adapter measurements on the same VM, not Discord command response guarantees. CAS conflicts force a fresh read; returned snapshots cannot mutate cached state. External read-only changes may be visible up to 250ms later. Both Windows and Linux passed 104 tests, including closure request races, expiry/restart behavior, early acknowledgement, and cache conflict recovery. The state-document architecture still transfers the whole state on writes and needs normalization for substantially higher scale.


## Queue worker and live ticket check — October 25, 2026
Recent pre-change production ticket jobs took 10.456-131.430 seconds from request to their opening message (six saved examples). After introducing prioritized concurrent work and removing fresh-delivery history scans, a private bot-only ticket exercised the real Supabase/outbox/Discord path: channel creation at 5,289 ms, opening message at 6,126 ms, and job completion observed at 11,772 ms. The test suppressed all human/role notifications and removed its channel and temporary state afterward. This is one measured live check, not a response-time guarantee or a 100x claim. Saved-work ordering, reserved foreground capacity, coalesced panels, interrupted delivery recovery, and long-job/recovery fencing have regression coverage.

## 2026-10-26 incident recovery

The live deployment's main state document measured 980,641 bytes. Its separated lease document measured 338 bytes. Lease renewal was observed advancing independently with maintenance disabled. This reduces the JSON body rewritten per heartbeat by over 99.9%; it is a payload measurement, not a measured percentage reduction in total Postgres disk I/O. Main state mutations still rewrite the saved state, and Supabase budget recovery must be checked in the provider's metrics. Read snapshots now last one second, and local CAS mutations are serialized. Both Windows and Linux regression suites passed (138 tests).

Archival locking explicitly supplies member/role overwrite types. Unknown Overwrite is skipped only after confirming that the member or role is absent. Other Discord errors retain the channel and retry. Live verification covers the affected closing tickets; archive transcripts must be confirmed before deletion.

Live recovery completed: all three affected tickets reached closed state, their transcript attachments were confirmed in Discord archives, and their original channels returned Unknown Channel after deletion. Safety-delay waits now reschedule at the configured deletion time without incrementing failure attempts or issuing error alerts.

### Revision-only polling (2026-10-26)

Supabase reads now check only `revision` when a cached snapshot expires. The full state is downloaded on first access, an external revision change, or after a failed/conflicting CAS. During an in-flight write, readers reuse the last committed snapshot rather than triggering another full download. A failed revision check is reported as failure; stale data is not silently treated as fresh.

The live six-second probe downloaded the initial state once (1,077,702 response-body bytes), then six revision responses of 18 bytes each: 108 polling bytes total. These are JSON response-body measurements, excluding HTTP overhead and not a promise about total organization usage. Existing billed usage is not reset. Both Windows and Linux tests passed (140 tests).

The October 26 reliability audit passed 156 tests on Windows and Linux, the 5,000-player load check on both platforms, and a private live open/archive/delete rehearsal. See [the audit report](RELIABILITY-AUDIT-2026-10-26.md) for measured timings, fixes, and remaining limits.

### Ticket speed follow-up — October 26

The final private rehearsal measured opening at 12,677 ms and archival/deletion at 10,329 ms, compared with the preceding audit's 26,192 ms and 48,150 ms. Transcript attachment confirmation preceded deletion. See [the performance report](TICKET-PERFORMANCE-2026-10-26.md) for changes, intermediate samples, recovery instructions and remaining limits. Database compression, batching, independent result posting and avoiding redundant lease lookups reduce work; they do not guarantee latency under provider throttling.

## Multi-mode candidate - 2026-11-03

Run `npm run build` then `node scripts/load-multimode.mjs`. Synthetic SQLite check on Windows: 24 queues, 300 shared player profiles projected across eight modes, 24 concurrent test reservations, no duplicate mode/region reservations. Seeding: 280 ms; reservation batch: 618 ms; p50: 484 ms; p95: 612 ms. Saved state: 617,618 bytes; combined lists: 24 pages. Measurements depend on hardware. These exclude Discord API/network latency, image downloads and archive uploads. Live queue/archive responsiveness remains a rehearsal requirement.

The same candidate on the home Linux VM passed 203 tests. Linux synthetic load: seed 219 ms, reservation batch 511 ms, p50 406 ms, p95 506 ms, same state size/page count and 24 verified tickets.
