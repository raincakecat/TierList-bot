# Standard legacy import format

Convert an old bot's actual export into this format before importing. The bot does not inspect another bot's database or invent missing information.

```json
{
  "format": "crystal-legacy",
  "version": 1,
  "guildId": "YOUR_SERVER_ID",
  "players": [],
  "restrictions": [],
  "tickets": [],
  "lists": [],
  "completions": []
}
```

`guildId` and player/member/channel IDs must be quoted 17–20-digit Discord IDs. Times are Unix milliseconds. Regions are enabled NA/EU/AS values. Tiers are Unranked or one of the ten LT/HT tiers. UUIDs are lowercase 32-character hex without hyphens.

Each **player** has `id`, `tier`, `uuid` (or null), `ign` (or null), `region` (or null), `preferredServer` (or null), `waitlist` boolean, and `cooldownUntil` (0 if none). Optional `testerSince` is a timestamp. A non-null UUID requires IGN/region and a unique association.

Each **restriction** has a unique `id`, `playerId`, `uuid`, `reason`, `until` (null for indefinite), and issuing staff `actor` Discord ID. Restrictions are independent of whether the current account remains linked.

Each **active ticket** has `channelId`, `type` (`test` or a configured support key), `opener`, `region` (nullable for support), `openingTier`, `openingIgn`, `tester` (nullable for unassigned direct high tests), `target` (nullable for evaluation tests), `passed`, `participants`, `openedAt`, and existing `name`. Optional `deadline` has `at`, `setter`, and `notified` boolean. Preserve explicit participants; supplied metadata controls adopted access. Test records must include their actual opening rank, not the interim LT3 rank after evaluation.

Each **list** has `tier`, `region`, and `members` array. Each member's saved tier must match. Restricted players will not be added. Automatic lists are rebuilt for linked players; supplied regional membership can then be retained.

Each **completion** has a unique `ticketId`, `tester` Discord ID, and actual completion `at`. Do not make up dates for old aggregate totals.

Preview is read-only. Global errors, such as the wrong server or a completed migration, block the import. Valid records can be applied while individual incomplete or conflicting records remain pending. Bot Review posts correction controls for missing metadata; Bot Admins can correct supported fields there. Conflicts requiring changes to multiple records must be corrected in the local import file. Resume the same import to apply corrected records without repeating completed records. Saved Discord jobs retry independently.

If the original opening rank is unknown, supply null for `openingTier` so it is held for review. Do not substitute a current or interim rank. Keep a copy of the original export before making corrections.

Place imports in `data/imports`, not in a publicly accessible directory. Apply requires Owner, migration enabled, maintenance, a matching server, valid channels, backup, and explicit confirmation. A completed import cannot be repeated.

Use the Discord setup wizard or a reviewed host configuration change to enable migration and map Bot Review. Initial server/database credentials remain on the host. `/health` reports saved retrying work. Backup restore and backend transfer now drain active work through an exclusive fence; they do not reverse external Discord changes. Rehearse migration and recovery with disposable data using LIVE-REHEARSAL.md and DATABASE-REHEARSAL.md.

Existing configuration/portable exports without LOA fields remain supported. New portable backups include saved LOA history and jobs; the standardized legacy importer does not import another bot's LOA records. Configure LOA separately after takeover rather than inventing old leave history.
