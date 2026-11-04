# Live rehearsal before community rollout

Automated tests simulate Discord. Use an isolated server, separate bot application, and disposable users/data for these checks. Do not describe them as passed until performed.

## Installation and wizard

- Install the full package on the target Linux VM; verify Node and runtime dependencies. Confirm working directory, service restart, private files, writable storage, and one-process enforcement.
- Invite with the documented scopes/intents. Run `/setup wizard` as an Administrator before initialization. Check Community, Features/Regions, Cooldowns/Quota, and all Resources pages.
- Confirm an ordinary member cannot open the wizard, another operator cannot use its controls, expired drafts fail, and cancellation changes no settings.
- Inspect the private JSON draft attachment before confirming. Check a supplied wrong role/channel/category ID fails before provisioning. Leave blank IDs to create resources; check a partial creation resumes rather than duplicating resources.
- After initialization, require Owner for the wizard and maintenance before applying it. Host-file edits after review must invalidate confirmation. Database credentials/server ID remain host-side.
- Validate and publish panels. View each ticket/archive/log channel as an ordinary member to confirm privacy. Use the created roles for actual operators.

## Verification and testing

- Valid/invalid IGN and duplicate UUID linking; the linked-account button shows the private Already Verified embed without reopening a modal.
- Unverify/reverify preserves rank and cooldown. Region versus waitlist role assignment remains separate. Check lookup failure produces a retryable message without creating a link.
- FIFO reservation with two testers, repeated clicks, tester stop, restart, and member departure during opening.
- Evaluation pass, category/name change, skip refusal after passing, discontinuation restoration, original tester credit, cooldown, and opening-rank result.
- Direct high-tier routes and opponent selection; mentions on ticket opening and `/add`; all six result reactions.
- Growing/shrinking lists and queues: complete mentions, no stale pages, no deletion of unrelated messages.

## Support and recovery

- Test every enabled support type's opener/access/ping/closing groups, including overflow. Ordinary Staff must not gain sensitive access by accident.
- Deadlines notify the setter once and do not close tickets. Restrictions clear lists/queues and prevent new tests.
- Close a report containing images, video, and a YouTube link. Confirm only images are copied and archival precedes deletion.
- Force an archive permission/download failure and restart; saved jobs retry and the original channel remains. Test an oversized transcript retains its channel.
- Change archive storage location in maintenance; verify expired images are cleaned from old ticket locations while transcripts and unrelated files remain.
- `/health` is private to Bot Admin/Owner; check unavailable-database output never includes credentials. State counters and backup time match observed activity.
- Restore/transfer during a deliberately slow job: active work finishes first, new state changes wait, lease renewal continues, and timeout does not start recovery. Maintenance remains enabled; a new confirmation can retry.
- Check external Discord differences before restoring old backups. Database restore cannot undo deleted channels or previously posted messages.

## Leave of absence

- Enable LOA through the wizard and create/reuse its two roles and three channels. Confirm portal/roster branding, private review access, and Staff-only accepted/request channels.
- Submit valid 1d-30d leave and reject nonstaff, duplicates, invalid durations, and blank reasons. Ensure the administrator role is pinged exactly for the request.
- Two admins attempt different decisions; only one succeeds. Denial requires a reason and sends a DM. Approval starts at decision time, grants the role and posts one accepted message.
- Withdraw before approval; end early as requester or LOA Admin. Other members cannot use those controls. Roster and review/accepted posts reflect decisions.
- Test blocked DMs, retry/restart during role assignment or message sending, expiry during maintenance/disabled creation, and rejoining with active versus expired leave.
- Check month-boundary exemption and historical early return. Test counts remain unchanged and the tester can still use /start.

## Record the result

Record host/Node versions, selected database, configuration revision, scenario, expected/actual result, and evidence. Use private issue attachments for account data. Record any failures before planning community cutover. Remote database checks are separate; see DATABASE-REHEARSAL.md.


## Requested closure and response latency
- In a disposable support ticket, run `/requestclose reason:Resolved timeout:1h`. Confirm only the opener can answer; a different staff member or Owner cannot answer on their behalf.
- Deny it and confirm the ticket stays open with disabled controls. A new request may then be submitted.
- Approve a new request and confirm closure starts immediately, transcript archival succeeds, then the channel is removed.
- Leave a 1h request unanswered, restart the bot, and verify automatic closure after expiry. Maintenance holds timeout processing until it is disabled.
- Verify `/health` and ordinary slash commands acknowledge promptly even during slow remote reads. Full human Discord timing remains a separate live check from adapter benchmarks.


## Queue availability and ticket priority
- Start a regional session: the queue updates, records its actual start time, and sends only `@here`, which is deleted by saved cleanup work.
- Stop the session: the last-session timestamp remains stable on the offline queue panel.
- Open a ticket while another ticket archives. Confirm the new ticket can open independently and its opening message has no reference footer.
- Restart gracefully during a test session and confirm it resumes promptly; test expired resume state separately in a disposable environment.
- Interrupt a delivery after send but before checkpoint persistence, then verify recovery does not post it twice. Backups/recovery must wait for all detached workers.

## Second-server multi-mode launch

Follow the eight-step checklist in MULTI-SERVER.md. All second-server live checks remain pending until role hierarchy and category capacity permit complete setup. Do not treat the local SQLite load check as evidence of Discord API latency.
