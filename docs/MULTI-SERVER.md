# Multi-server and mode setup

This update is an implementation candidate. Keep the second community in maintenance until its live Discord rehearsal passes. Existing single-server configurations default to Crystal and keep their stored ticket, rank, cooldown, job and message identifiers.

## Host configuration

Use the same bot application and process for both servers. Copy `config.multimode.example.json` to a private configuration file, then set its guild ID. Keep the existing Crystal configuration as the first entry. In the host `.env`, add:

```dotenv
BOT_CONFIGS=["config.json","data/configs/other-modes.json"]
```

Every configuration must use exactly the same database settings. For an existing deployment, keep its existing SQLite path and primary guild first. Start from a stopped service with a validated backup, including host configuration, local policy, database and evidence directories. Never run the old and candidate processes as simultaneous writers.

Credentials and private mappings do not belong in the repository. The new example has no real server, role, channel or member IDs. It enables Sword, Axe, SMP, Pot, Mace, UHC, Nethpot and Spear Mace, each with NA, EU and canonical AS (displayed as AS/AU). Each mode initially uses four-day normal and high cooldowns. Support and LOA settings are shared within a server, independently of Crystal.

## Discord resources

Invite the same bot to the second server, then place its role above every role it assigns. Map existing common roles and channels first. `/setup preview` and the private `/setup wizard mode:Sword` help review mappings; `/setup apply` provisions missing resources for all configured modes and saves every successful creation. A restart can continue from saved IDs. This does not delete unrelated resources.

The default multi-mode layout uses three regional categories (NA Queue, EU Queue, AS/AU Queue), each with eight mode queue channels, plus eight mode High Tests categories. There are 24 waitlist roles, eight tester roles and separate tier roles per mode. Evaluation tickets open in their regional category and retain mode identifiers. `queueLayout: "regional"` enables shared regional categories; the compatible `per-mode` option retains separate mode/region categories. Common support resources and overflow also need capacity. Discord limits a server to 50 categories, 250 roles and 500 channels including categories. Setup checks available capacity before creating resources. Reuse or remove unused categories before setup if the planned resources do not fit; leave spare capacity for overflow. Reference: https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More

The High Testing Lists forum contains one bot-managed post per mode. Posts group NA, EU, then AS/AU; entries use HT3, LT2, HT2, then LT1, alphabetically within each tier. HT3 membership remains manual. Longer lists use continuation messages; obsolete pages are deleted. Archived posts are reopened and reused. Crystal continues using its existing list channels.

## Staff and player workflows

- Verify separately in each server. Minecraft account linking is shared; region and preferred server belong to the current server. Username lookup validates account existence, not ownership.
- Enter Waitlist offers a mode multi-select in the second server. Each selection reports its own eligibility result. Verification does not copy Crystal ranks or cooldowns.
- `/start mode:Sword region:NA` requires Staff and the Sword Tester role. A tester may run one session per server. `/next` and `/stop` follow that saved session.
- Ticket commands infer their mode from a registered testing ticket. Outside an unambiguous ticket/queue context, provide `mode` for rank, cooldown, profile, list and similar operations. Staff can be assigned to and handle tests without holding the mode's queue-opening role.
- Players may queue and test in several modes at once, with one active test per mode. Restrictions block all modes in the current server and retain each mode's prior rank for unrestriction.
- Results from all eight modes use the server's shared results channel, with the mode displayed and existing reactions retained. Opening pings use the exact mode/region waitlist role until that queue closes.
- `/allcdreset`, `/forceclosetickets` and `/purgehightests` affect only the invoking server. `/purgehightests start mode:Sword` optionally narrows the purge; omitting mode covers every mode, including registered overflow tickets. Legacy overflow channels need a mode prefix to identify their scope safely.
- Bot Admin `/unverify` clears the invoking server's link only. `/unverify scope:global` requires Owner confirmation and clears links across servers. It preserves ranks/cooldowns and rejects unlinking while open tests exist.

## Persistence and recovery

Stable guild IDs, mode keys, Discord IDs and UUIDs identify records. Existing Crystal state remains the primary partition; additional servers and mode records are included in the same database. Account uniqueness is checked in the atomic database revision update. Interaction and job execution select the server and mode before role/channel operations.

`/backup export` and restore use a complete snapshot of the invoking server, including every mode. Restoring rejects Minecraft identity conflicts with other servers and preserves their current data. Restore requires maintenance, waits for running work, clears active sessions and leaves maintenance enabled. Keep a complete deployment backup for VM/disk recovery as well as server exports.

`/backup transfer` copies the complete deployment into an empty destination database. Every server must be in maintenance; the destination configuration must identify the primary server. After verification, stop the bot and switch all configuration files together. Do not independently transfer only one server into a new live database and assume shared identity enforcement spans the two databases.

## Live rehearsal before enabling requests

1. Validate every mode's mappings, bot role hierarchy, private category access, archive destinations and forum permissions. Confirm capacity for overflow.
2. Check both guilds connect and that Crystal's ranks, cooldowns, existing tickets and message references remain unchanged.
3. Verify the same account in both guilds, select different regions, and reject conflicting UUID claims. Test server-only and confirmed global unlink.
4. Join two mode queues, create independent tests, check tester-role permissions and confirm one tester session per server.
5. Exercise evaluation progression, result fields/reactions, restriction/unrestriction, support, LOA, queue pings, list updates and archived forum recovery.
6. Restart while role/archive jobs are pending. Confirm each resumes in the right server/mode without duplicate tickets or messages.
7. Restore a test-server backup that conflicts with another server's link and confirm the restore is rejected without replacing current data.
8. Check `/health`, ticket creation timing and archive timing under concurrent work. Only then disable maintenance for player requests.

The future Minecraft mod and API are outside this update.
