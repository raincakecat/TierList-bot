**What the new bot does (1/5)**

Here’s what I’ve put into the bot so far. It covers tier testing, support tickets and staff LOAs, so those can all be handled in one place.

**Accounts and queues**
- Players enter their IGN, region and preferred server. The bot checks the Minecraft account and links it to their Discord. The same Minecraft account can’t be linked to two people at once.
- Verification gives them their region role. Entering the waitlist gives them the separate waitlist role and access to their regional queue.
- NA, EU and AS each have their own queue, with positions, available testers and alerts when someone joins.
- Testers use `/start`, `/stop` and `/next`. The person waiting longest gets taken next, and two testers can’t take the same person.
- Players can leave the queue themselves. Queue size and normal/high-test cooldowns are configurable.
- Evaluation tickets open as `test-username-region`. `/passeval` gives LT3 and moves the ticket into HT3 testing with the new name. It can’t be skipped after that.
- Players who already have HT3, LT2, HT2 or LT1 go straight to a ticket for their next tier.
- `/profile` shows a player’s saved details. Clicking Verify again shows the account they already linked.
- If someone linked the wrong account or lost access to it, a Bot Admin can use `/unverify`. Their Discord rank and cooldown stay saved when they link a replacement.

The username check confirms the Minecraft account exists; it doesn’t prove the person owns it.

---

**Results and testing tools (2/5)**

**Finishing tests**
- `/close` records the result and updates the player’s rank roles. The result embed shows the player, tester, region, IGN, previous rank and earned rank.
- Previous rank means the rank they had when the ticket opened, even if they got LT3 during evaluation.
- Results get the reactions 👑 🥳 😱 😭 😂 💀.
- The original tester gets credit once for a completed test. Test Discontinued puts the player back at their opening rank and doesn’t count as a completed test.
- `/format` posts the fight-result template in the ticket.

**Lists and staff tools**
- HT3, LT2, HT2, LT1 and HT1 each have a list split by region. LT2 and above update automatically for eligible linked players; HT3 is added manually.
- Staff can view the lists, and List Admins can add or remove people. Long lists and queues split into pages, with old extra pages cleared when they shrink.
- Opening a testing ticket pings the player and assigned tester. `/add` gives someone access and pings them, including when assigning a tester to an unassigned high test.
- `/remove` removes added participants, and `/rename` changes the ticket name.
- `/addht3` and `/addlt2` let staff pick an eligible opponent from the regional list.
- `/set-ticket` lets staff register an existing channel as a ticket. `/changeticket` changes its route where allowed.
- `/uuid` looks up a Minecraft UUID from an IGN.
- `/stats`, `/testerstats` and `/testerlb` show tester counts, quota progress and leaderboards. Monthly quotas and reports can be turned on if wanted.

---

**Support tickets and moderation (3/5)**

**Support tickets**
The bot also handles General Support, Player Reports, Staff Reports, Restriction Appeals and Partnership Requests. More ticket types can be configured, along with their opening messages, staff access, pings and who can close them.

- Support opening messages are pinned, and the opener and responsible team are pinged.
- Tickets stay private to the people and teams meant to see them.
- If a category fills up, the bot uses overflow categories while keeping the ticket’s access rules.

**Restrictions and deadlines**
- `/restrict` restricts a Discord/Minecraft account pair, blocks testing and removes them from queues and high-tier lists. Restrictions can have a duration or stay until removed.
- `/unrestrict` removes the restriction. List membership isn’t automatically restored when a restriction ends.
- Regulators can set a ticket deadline with `/deadline set`, from `1m` to `14d`, including things like `3h` or `2d`.
- When time runs out, the person who set it gets pinged to review the ticket. It doesn’t close on its own. `/deadline clear` removes it.
- There are also permission-controlled commands to force a test, stop a regional queue, assign a result or migrate an individual rank.

**Keeping ticket records**
Before deleting a closed ticket, the bot saves its transcript and any required image evidence. If that fails, it keeps the channel and retries.

Image saving is configurable for reports and appeals, with ten days as the default retention. Videos aren’t downloaded, but attachment and YouTube links stay in the transcript. Transcripts don’t automatically expire, and unfinished background work can resume after a restart.

---

**Staff LOAs (4/5)**

There’s a leave-of-absence system too, with an LOA role and a separate LOA Admin role.

**Requesting and reviewing leave**
- Staff click the button in Request LOA and enter their username, how long they’ll be away (`1d`–`30d`) and their reason.
- The request goes to LOA In Progress and pings LOA Admins. Only LOA Admins and Owners can accept or deny it, and denying it requires a reason.
- Accepted requests go into Accepted LOA. The person gets the LOA role, with their leave starting when it’s approved.
- They get a DM for approval, denial, expiry and early return. If their DMs are blocked, that’s recorded privately without undoing the decision.
- The request panel also has an updated list of everyone on approved LOA and when they’re due back.

**Returning and quotas**
- The role is removed when leave expires. Saved leave still expires after a restart or if new requests are disabled.
- People can withdraw a pending request or use End My LOA if they return early. LOA Admins can also end leave with a reason.
- `/loa status` shows their saved leave and the relevant controls. Other staff can’t use it to read someone else’s pending or denied reasons.
- Any approved LOA that overlaps a month makes that tester exempt from that month’s quota. If they return early, it uses the time they actually spent on leave.
- They can still use `/start` and test while on LOA. Their completed tests and leaderboard counts still count normally.
- Rejoining while leave is active restores the role; rejoining after it expired doesn’t.

Only one pending or active request is allowed per person.

---

**Setup and switching over (5/5)**

**For the people managing the bot**
- There’s a private Discord setup wizard for the features, regions, cooldowns, quotas and role/channel settings. It can use existing resources or create missing ones after a preview.
- The server name, colors and messages can be changed to fit the community.
- Permissions are split between Owners, Bot Admins, Staff, Testers, Regulators, List Admins, Restriction Keys, LOA Admins and the different support teams.
- Admin tools cover assigning testers, changing cooldowns, maintenance mode and bulk actions with confirmation prompts.
- `/health` shows bot status, pending work, backups and configuration issues to authorized admins.
- There are daily backups, restore/transfer tools, staff action logs and private channels for problems that need review.

**Moving the existing data**
The migration tools can keep ranks, linked accounts, supported testing history, lists and existing ticket channels, provided we get a compatible export from the current bot. Anything missing or conflicting gets held for review.

We’ll need the old data exported and prepared properly before moving it. There shouldn’t need to be a tier reset if the required records are available.

**Where things stand**
The current build is v0.2.0, with 61 automated tests passing and installation checks passed on Windows and Linux. It still needs a proper run-through in a test Discord server and with the chosen remote database before we replace the current bots.

Which commands each person can use will depend on their assigned roles and which features we enable.
