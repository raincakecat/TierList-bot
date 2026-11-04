# Staff guide

Use this for ticket handling, common player problems and leave requests. Command permissions follow the bot's specific roles; reading this guide does not grant those permissions. Testing tickets infer their mode. Outside a clear ticket or queue context, supply `mode` for mode-specific commands.

## Which team handles which ticket?

**Staff:** general support and testing tickets.

**High Staff:** player reports, staff reports and restriction appeals.

**Partnership Manager:** partnership requests.

**Owner:** can handle every type. Bot Admin, Regulator or a high Discord rank does not by itself replace a ticket's responsible closing role. You must also have access to the channel.

Use the configured request panels. A channel with a similar name is not automatically a registered ticket.

## Work in a ticket

`/add member:@person` — Add someone who needs access. In an unassigned testing ticket, adding an eligible staff member also assigns the tester.

`/remove member:@person` — Remove an added participant; not the opener or original tester.

`/rename name:...` — Rename the current registered ticket so its purpose is clear.

`/profile member:@player mode:Sword` — Check the linked account, region and mode rank. `/uuid ign:PlayerName` looks up a valid Minecraft account's UUID. A username lookup does not prove account ownership.

Use `/format tier:...` to post a fight template in a testing ticket. Testing outcomes use `/close tier:...`, not the support force-close commands. See the Tester guide for evaluation and high-test progression.

## Close support tickets

`/requestclose reason:Issue resolved timeout:2d` — Ask the opener to approve closure. Allowed timeouts are **1h–7d**. Approval closes immediately through archival; denial keeps the ticket open; no answer closes it at expiry.

`/ticketclose reason:Issue resolved` — Force close the current support ticket without waiting for the opener. `/forceclose` does the same thing. A reason is required, and only the responsible closing team or Owner can use it.

The Close button opens a reason form for responsible staff. These tools save the transcript before deletion. If archival fails, the bot keeps the channel and retries. Check with a Bot Admin rather than repeatedly issuing closes or deleting the channel manually.

Using `/requestclose` in a testing ticket discontinues that test; it does not award a rank or completed-test credit. Use the proper testing result workflow when a test was completed.

## Register or route an existing channel

`/maketestticket member:@player tester:@staff mode:Sword` — Register the current channel as a test. Use this to recover a channel that exists but is not registered. The assigned tester must be authorized Staff in this multi-mode server.

`/set-ticket type:general-support member:@player` — Register an existing support channel. Supported type keys are `general-support`, `player-report`, `staff-report`, `restriction-appeal`, and `partnership-request`. `test` is available for testing registration too.

`/changeticket type:...` — Change a registered ticket's support type or testing route. `test` and `high` are testing routes. Supply the original tester when converting to testing, and check the opener/region first.

Use these when recovering or routing an actual ticket, not in queue, list, guide or ordinary chat channels. The bot updates the relevant access rules when a type changes.

## Leave of absence

Open Request LOA and use **Request Leave of Absence**. Enter your username, a whole-day duration such as `7d` and a reason. Requests are **1–30 days**, start when approved, and allow one pending or active leave per person.

`/loa status` — View your request or leave. You can withdraw a pending request or end your own active leave using its controls. `/loa status member:@person` shows the information your roles are allowed to see.

Only LOA Admins and Owners accept/deny requests or use `/loa end member:@person reason:...`. Denial needs a reason. The bot sends the decision by DM when possible and removes the LOA role at expiry or early return.

Approved leave exempts overlapping monthly quota periods. It does not stop you testing, erase completed tests or remove leaderboard results.

## Extra roles and escalation

**CD Resetter or Bot Admin:** `/resetcooldown member:@player mode:Sword` clears one mode cooldown. Staff alone cannot reset it.

**Restriction Moderator:** `/restrict member:@player ign:Name reason:... duration:7d` and `/unrestrict member:@player`. Restrictions affect every mode in this server. Review list membership afterward; HT3 membership is manual.

**List Admin:** `/ht3list add member:@player region:NA mode:Sword` and the corresponding `remove` command. LT2, HT2 and LT1 have equivalent commands. The player must hold the matching tier and be unrestricted.

**Bot Admin:** unlinking a wrong account, tester-role assignment, cooldown settings and bot health.

**Regulator:** forced tests/results, queue shutdowns, migrations and ticket deadlines.

**High Staff:** sensitive reports and appeals. **Owner:** setup, recovery and confirmed bulk actions. Use the High Staff guide for the full advanced reference.
