# First test server

You do not need a test server to inspect this package. Use an isolated server before inviting the bot to a real community.

1. Create a new empty Discord server that you control. Enable Developer Mode in Discord settings, then copy the server ID into `community.guildId` in `config.json`.
2. Create a separate bot application in the Discord Developer Portal. Keep its token only in your local `.env` file. Enable Server Members, Message Content, and Presence intents.
3. Invite it with the `bot` and `applications.commands` scopes. Follow the permission and role hierarchy instructions in README.md.
4. For a first local rehearsal, choose `database.backend: "sqlite"`. This needs no separate database account. Supabase and PostgreSQL can be tested later with their own dedicated test databases.
5. Keep role/channel/category IDs null for resources you want setup to create. Start the bot, run `/setup wizard`, choose modules/regions/cooldowns and resource mappings, then review and confirm the attached draft. `/setup preview` and `/setup apply` remain available.
6. Run `/config validate`, then `/panels refresh`. Use a second Discord account or a consenting tester to check user access separately from staff access.

Rehearse verification, duplicate account rejection, regional access, normal queues, evaluation passing, direct high tests, results and six reactions, support permissions, restrictions, deadlines, archive recovery, and restart recovery. Check that unrelated members cannot see private tickets or archive channels.

Use only disposable test data when checking restore or migration. Keep the old community bots running until the isolated rehearsal and a reviewed takeover plan pass. See STATUS.md for the remaining release checks.

Use `/health` as Bot Admin/Owner to check job and backup status. Follow LIVE-REHEARSAL.md for wizard privacy, archive retention, and recovery race tests; remote database checks are described in DATABASE-REHEARSAL.md.
