**Tier List + Staff Bot — Feature Overview (1/5)**

**Accounts and regional access**
- Link a Minecraft username to a Discord member using an account/UUID lookup.
- Save the player's region (NA, EU, or AS) and preferred Minecraft server.
- Prevent the same Minecraft account from being linked to multiple Discord members at once.
- Assign regional roles on verification and separate waitlist access roles on waitlist entry.
- Show an Already Verified embed with the saved IGN, UUID, and account thumbnail.
- Let Bot Admins unlink an incorrect or lost account without removing the member's Discord rank or cooldown.
- View saved player information with `/profile`.

**Regional testing queues**
- Separate NA, EU, and AS queues with Join Queue and Leave controls.
- Tester availability panels, queue positions, and staff queue alerts.
- `/start`, `/stop`, and `/next` for tester sessions and first-in, first-out testing.
- Protection against duplicate active tests and competing reservations for the same player.
- Regional evaluation tickets named `test-username-region`.
- `/passeval` records LT3, moves the ticket into HT3 testing, and renames it.
- Passing evaluation prevents the ticket from being skipped afterward.
- Existing HT3, LT2, HT2, and LT1 players request their next high-tier test directly.
- Configurable queue capacity and separate normal/high-test cooldowns.

*Account lookup confirms an account exists; it does not prove Minecraft account ownership.*

---

**Results, Lists, and Testing Tools (2/5)**

**Results and ranks**
- `/close` finishes a test with an earned tier or Test Discontinued.
- Result embeds include the player, tester, region, username, original rank, and earned rank.
- Previous Rank is captured when the ticket opens, before any interim evaluation rank.
- Result messages receive the six reactions: 👑 🥳 😱 😭 😂 💀.
- Rank roles update after results; eligible completed tests credit the original tester once.
- Discontinuing a test restores its opening rank without counting it as a completed test.
- `/format` posts Markdown fight-result templates.

**High-tier lists**
- Maintained HT3, LT2, HT2, LT1, and HT1 list embeds, separated by region.
- LT2 and higher membership updates automatically for eligible linked players; HT3 entry is manual.
- List Admin commands manage regional membership; Staff can view the lists.
- Large lists and queues paginate, and obsolete extra pages are removed.

**Staff testing tools**
- Mention the player and assigned tester when a testing ticket opens.
- `/add` grants ticket access and mentions the added person; `/remove` manages added participants.
- `/rename` changes a ticket's channel name.
- `/addht3` and `/addlt2` select eligible regional opponents.
- `/set-ticket` registers an existing channel, and `/changeticket` changes permitted ticket routes.
- `/uuid` looks up an IGN's Minecraft UUID.
- `/stats`, `/testerstats`, and `/testerlb` provide counts, quota statistics, and leaderboards.
- Optional monthly tester quotas and monthly quota reports.

---

**Support, Restrictions, and Evidence (3/5)**

**Support tickets in the same bot**
- General Support, Player Reports, Staff Reports, Restriction Appeals, and Partnership Requests.
- Configurable custom ticket types, opening messages, responsible teams, and close permissions.
- Private ticket access, opening mentions, and pinned support opening messages.
- Type-specific access remains in place when tickets use overflow categories.
- Automatic overflow-category handling when the normal category fills.

**Restrictions and regulator tools**
- `/restrict` applies a Discord/Minecraft account-pair restriction, with an optional duration.
- Restricted accounts are blocked from testing and removed from queues and high-tier lists.
- `/unrestrict` removes a restriction; expiry does not automatically restore list membership.
- `/deadline set` accepts 1 minute through 14 days, including values such as `3h` and `2d`.
- Deadlines notify the person who set them for review; they do not automatically close tickets.
- `/deadline clear` cancels a deadline.
- Authorized commands can force a test, stop a regional queue, assign a result, or migrate an individual rank.

**Transcripts and evidence**
- Ticket closure queues a Markdown transcript and required image evidence before channel deletion.
- Failed required archival keeps the original channel available for staff review.
- Report/appeal image copying is configurable, with a default ten-day image retention period.
- Video files are not copied; attachment and YouTube links remain in transcripts.
- Saved work retries after failures or restarts; transcripts do not automatically expire.

---

**Staff Leave of Absence (4/5)**

**Requesting leave**
- A branded Staff Leave Portal with a Request Leave of Absence button.
- An automatically updated Members on LOA roster showing return dates.
- Staff enter a username, a whole-day duration from `1d` to `30d`, and a reason.
- One pending or active request per Discord member.
- Requesters can withdraw their own pending request.

**Review and approval**
- Two roles: LOA and LOA Admin.
- Three channels: Request LOA, LOA In Progress, and Accepted LOA.
- New requests ping LOA Admins in the private review channel.
- LOA Admins and Owners can accept or deny; denial requires a reason.
- Approved requests appear in Accepted LOA and grant the LOA role.
- Leave starts when approved and runs for the approved duration.
- Approval, denial, expiry, and early return send a DM; blocked DMs are recorded privately.

**Return and quota rules**
- Automatic LOA role removal at expiry, including recovery after a restart.
- Requesters can use End My LOA; LOA Admins can end leave with a reason.
- `/loa status` shows the relevant saved leave status and personal controls.
- Other Staff cannot use status lookup to read someone else's pending/denied reasons.
- Any approved leave overlapping a month exempts that tester from that month's quota.
- LOA does not stop active tester sessions or prevent `/start`.
- Completed tests and leaderboard counts continue normally.
- Active leave is restored on rejoin; expired leave is not.
- Disabling new requests does not stop existing leave from expiring.

---

**Administration and Rollout (5/5)**

**Management features**
- A private Discord setup wizard for community settings, enabled features, regions, cooldowns, quotas, and resource mappings.
- Reuse existing roles/channels/categories or create missing resources after reviewing a preview.
- Configurable community branding, embed colors, and messages.
- Separate permission groups for Owners, Bot Admins, Staff, Testers, Regulators, List Admins, Restriction Keys, LOA Admins, and support teams.
- Tester assignment, individual cooldown changes, maintenance mode, and reviewed bulk management commands.
- Private `/health` checks for bot status, pending work, backups, and configuration problems.
- Daily backups, reviewed restore/transfer tools, and recovery safeguards.
- Staff action logging and private operational/review channels.

**Moving from existing bots**
- An optional importer can preserve ranks, account associations, supported testing history, list memberships, and existing ticket channels from a compatible export.
- Missing or conflicting import information is held for review rather than guessed.
- Migration requires the old data to be exported and prepared correctly; a tier reset should not be needed when the required records are available.

**Current status**
Version 0.2.0 is built and has 61 passing automated tests, plus Windows/Linux installation checks. Live Discord and real remote-database rehearsal are still required before replacing the current bots.

*Features and commands depend on the modules enabled and the permissions assigned to your role.*
