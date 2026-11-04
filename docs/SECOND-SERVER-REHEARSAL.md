# Multi-mode Discord rehearsal - 2026-11-03

The live API rehearsal used an isolated state store and the bot account as the temporary participant. Its test profiles, tickets, leave records, jobs and temporary managed roles were removed before preparing the new server state. Existing Crystal data remained separate.

Passed:

- 24 queue channels, matching waitlist roles and private category access; other modes' waitlist roles do not grant queue access.
- Three shared categories named NA Queue, EU Queue and AS/AU Queue, with eight mode queue channels each; evaluation tickets open in the appropriate region category.
- Eight separate mode High Tests categories and eight bot-managed forum posts.
- Queue opening role mentions, updates and ping removal when sessions close across all 24 queues.
- Account lookup/linking, simultaneous Sword and Axe testing tickets, promotion into the correct High Tests category and mode-aware ticket naming.
- Result posting, required transcript upload before deletion and resuming archive work using a newly created worker.
- Support-ticket creation, denying a closure request and forced closure with archival.
- Server-wide restriction/unrestriction retaining mode ranks.
- LOA approval, early termination, blocked-DM handling, role removal and continuing to open a testing session while on leave.
- Owner/admin resource validation for every mode and permission isolation after regional regrouping.

The rehearsal found and fixed duplicate allowed-mention recipients and a missing mode prefix after evaluation. Maintenance now schedules an LOA portal refresh so its request button reflects the current state.

207 regression tests pass on Windows and Linux. The candidate remains subject to real staff account checks for client rendering, slash-command discovery, interactive verification and individual tester-role assignments. Do not infer Minecraft account ownership from username lookup. Local/isolated API checks do not guarantee Discord availability or throughput.

Deployment checks confirmed both server runtimes connected, current-server maintenance disabled, the LOA request control enabled, all eight mode choices registered in /start, and no pending/retrying second-server jobs. Closed queue panels use No Testers Online, including while maintenance is enabled; request blocking remains enforced separately.
