# High Staff guide

Use this for sensitive tickets and advanced bot operations. Each section names the role it actually requires. The High Staff role does not automatically grant Regulator, Bot Admin, Restriction Moderator, List Admin, LOA Admin or Owner permissions.

## Reports, appeals and sensitive support — High Staff

High Staff handles **player reports, staff reports and restriction appeals**. General support belongs to Staff; partnerships belong to Partnership Managers. Owners can handle every type.

Use `/add`, `/remove` and `/rename` when managing access and routing. `/changeticket type:staff-report` moves an existing registered ticket to the appropriate support route and updates its access.

`/requestclose reason:... timeout:2d` lets the opener approve or deny closure. No response closes it at expiry; denial keeps it open. Use `/ticketclose reason:...` or `/forceclose reason:...` when closure should not wait for opener approval. Both are support-only and still require successful transcript archival.

Keep sensitive evidence in its ticket and type-specific archive. Do not move a staff report's transcript into an ordinary staff chat or general archive.

## Testing intervention — Regulator

`/forcetest member:@player region:EU mode:Sword` — Open the player's next appropriate test without the normal queue/cooldown wait. They still need verification, the correct saved region, no restriction and no existing test in that mode. Use for an approved recovery or exceptional test, not a routine queue skip.

`/forcestopqueue region:NA mode:Sword` — Stop sessions and clear that mode's regional queue when it must close.

`/forceresult member:@player tier:HT3 region:NA mode:Sword` — Assign a reviewed result outside an active test. `/migrate member:@player tier:HT3 region:NA source:Community mode:Sword` records a migrated rank. An unverified player needs `ign`. Check the mode, region, previous rank and supporting evidence first; finish any existing test in that mode before forcing a result.

`/deadline set duration:3h` — Add or replace a deadline in the current ticket. Durations are **1m–14d**. `/deadline clear` removes it. Expiry pings the setter for review; it does not close the ticket.

## Restrictions and high lists — separate roles

**Restriction Moderator:** `/restrict member:@player ign:Name reason:... duration:7d`. Omit duration for an indefinite restriction. This blocks every mode in the current server, removes queues/high-list entries and synchronizes the Restricted role.

`/unrestrict member:@player` removes the restriction and restores each saved pre-restriction tier. Existing cooldowns remain. Review list membership afterward; manual HT3 membership is not automatically reinstated.

**List Admin:** `/ht3list add|remove member:@player region:NA mode:Sword`. Equivalent commands exist for `lt2list`, `ht2list` and `lt1list`. Adds require the matching tier and no restriction. Staff can use each command's `list` subcommand to view members.

The forum is generated from these mode records. Don't maintain a second manual list in an old list channel. The display is NA → EU → AS/AU, with HT3 → LT2 → HT2 → LT1 in each region. There is no HT1 list.

## Tester access and player accounts — Bot Admin

`/addtester member:@person mode:Sword` — Assign Staff and that mode's Tester role. `/stoptester member:@person mode:Sword` removes that mode's tester authorization and stops its active session; it does not remove Staff.

`/unverify member:@player scope:server` — Unlink the current server's account association so the player can verify again with a corrected account, region or preferred server. Ranks/cooldowns remain. The other server's verification is preserved, and open tests must finish before unlinking.

The Minecraft identity is shared across servers. Changing that shared account requires **Owner-confirmed** `/unverify scope:global`; it clears verification in both servers and is blocked while either has an open test. Do not work around identity conflicts by assigning a UUID to another Discord account.

`/resetcooldown member:@player mode:Sword` — Individual reset; CD Resetters can use this too.

`/setcooldown member:@player days:4 mode:Sword` — Set the saved cooldown directly. `/configcooldown kind:normal duration:4d mode:Sword` changes the duration for future completed tests; use `high` for high tests and `0` for no cooldown.

`/configquota count:...` sets the server's monthly quota; `0` disables it. It does not change completed-test counts.

## Bot checks and LOA administration

**Bot Admin:** `/health` privately reports database availability, maintenance, job backlog/retries, backup time and configuration problems. Use it when an operation is slow, missing or retrying. `/panels refresh` republishes the configured request, queue, LOA and list panels.

If closing stalls, check the operational log, archive channel permissions and upload failures. Transcript destinations are required: deleting them prevents safe ticket deletion. Repair the destination and let saved work retry; don't erase the source ticket or database jobs.

**LOA Admin:** Accept/Deny controls are in LOA In Progress. Denial requires a reason. `/loa end member:@person reason:...` ends approved leave early. Approval starts the leave, updates Accepted LOA and assigns its timed role. A blocked DM is recorded privately and does not undo the decision.

## Setup and recovery — Owner

`/setup wizard mode:Sword`, `/setup preview` and `/setup apply` manage resources. `/config validate` checks mappings; `/config reload` loads reviewed host-file changes. Live mapping/module changes require maintenance.

`/maintenance enabled:true|false` controls requests. It stops testing sessions when enabled. Public closed queues still show No Testers Online; `/health` shows the actual maintenance state.

`/backup export` saves this server with all its modes. `/backup restore filename:...` requires maintenance, waits for active work, rejects account-link conflicts with another server and leaves maintenance enabled.

`/backup transfer config:...` copies the complete deployment to an empty destination. Every server must be in maintenance; stop the process and switch all configuration files together after verification. Credentials stay on the host.

`/reset member:@player mode:Sword` resets that mode's rank, cooldown, queue and list membership while retaining shared verification, other modes, restrictions and archives. Review the confirmation carefully.

Optional `/migration preview`, `/migration apply` and `/migration retry` are for standardized legacy imports when that module is enabled. They are not a normal player rank-transfer workflow; use the Regulator migration command for an individual approved rank.

## Bulk actions — Owner

`/purgehightests start reason:...` previews an asynchronous high-test purge, including registered overflow tickets. Add `mode:Sword` to narrow it. Confirmation queues the work; `/purgehightests status` shows progress. Every transcript must upload before deletion. Ranks/cooldowns are retained and no completed-test credit is awarded.

`/allcdreset` — Confirm and clear cooldowns for all modes in this server. `/forceresetcooldowns` is the supported equivalent. A CD Resetter or Bot Admin alone cannot use the bulk reset.

`/forceclosetickets` — Confirm discontinuation/archival of this server's open tickets. This is broader than the high-test purge. Do not use it to resolve one person's ticket.

These actions stay scoped to the invoking server. The bot's Owner role is required; Discord Administrator by itself does not grant initialized bot Owner commands.
