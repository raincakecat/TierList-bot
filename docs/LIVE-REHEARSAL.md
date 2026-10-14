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

## Record the result

Record host/Node versions, selected database, configuration revision, scenario, expected/actual result, and evidence. Use private issue attachments for account data. Record any failures before planning community cutover. Remote database checks are separate; see DATABASE-REHEARSAL.md.
