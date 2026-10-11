# Configurable Crystal Bot

Configurable implementation candidate for Crystal PvP verification, regional testing, tier lists, support tickets, restrictions, deadlines, and portable backups.

**Full package:** [Download the ZIP with compiled files and PDF setup guide](full-package/full-package.zip), or [read the PDF guide](docs/Full-Setup-Guide.pdf).

**Status:** code builds and automated local checks run. It has not been connected to a live Discord server or a real Supabase/PostgreSQL deployment. Rehearse in a test server before production cutover. See `docs/STATUS.md` for the remaining release checks.

## Install the ready-to-run ZIP

1. Install Node.js **24.17.0 or newer** on Windows, Linux, or macOS.
2. Extract the ZIP into its own directory. Open a terminal in that directory.
3. Run `npm ci --omit=dev` to install the pinned runtime dependencies.
4. Copy `config.example.json` to `config.json`, and `.env.example` to `.env`.
5. Set `community.guildId` to your server ID as a quoted string. Set `DISCORD_TOKEN` in `.env`.
6. Choose a database. Supabase is the example default; follow the database instructions below. Never commit `.env` or your live configuration.
7. Choose cooldowns explicitly: `"0"` means none, or use values such as `"7d"`. Disable quotas or choose a monthly quota. Enable only the modules and regions you need.
8. Put the bot's role above every role it will assign. Enable **Server Members**, **Message Content**, and **Presence** privileged intents in the Discord Developer Portal. Invite with `bot` and `applications.commands` scopes and the permissions described below.
9. Run `npm start`. A Discord administrator uses `/setup preview`, then `/setup apply` and confirms the preview. You can supply existing resource IDs, create missing ones, or combine both. Setup saves each successful creation to `config.json`.
10. Run `/config validate`. Fix reported problems before publishing panels or opening tests. `/panels refresh` updates the configured panels.

Normal operation requires Manage Channels, Manage Roles, View Channel, Send Messages, Read Message History, Attach Files, Embed Links, Add Reactions, Mention Everyone (for the agreed regional announcement), and Manage Messages (pinning opening messages). Grant these in the appropriate channels. The bot never needs a personal Discord account token.

## Database options

- **Supabase:** run `sql/supabase.sql` once in your own project's SQL editor. Set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` in `.env`. The state table uses RLS and does not allow anonymous/authenticated API clients. Use a dedicated project for the bot.
- **PostgreSQL:** set `database.backend` to `postgresql` and set `DATABASE_URL` in `.env`. The connection's account needs permission to create the private `crystal` schema and its state table. Configure TLS in the connection settings for remote databases; do not disable certificate verification.
- **SQLite:** set `database.backend` to `sqlite`. The local file defaults to `data/crystal-bot.sqlite`. Use a local disk rather than a shared network filesystem. Node's built-in SQLite module may print its experimental warning on Node 24.

Each installation uses one guild and one active process. A database lease prevents simultaneous bot processes. An unclean shutdown may require waiting up to 60 seconds before restart.

The first persistence implementation stores a versioned community state document with atomic revision updates. This keeps all account, queue, ticket, and job changes consistent across backends. It is intended for one community per instance; large-scale data growth needs performance measurement before release. Archived channel messages live in transcript files, not in the state document.

## Configuration changes

Edit the local JSON file and run `/config reload`. The bot checks the new file and Discord resources before changing the active configuration. Database/server changes require stopping the bot and a reviewed transfer. Resource mapping and feature changes require maintenance. Old tickets keep their saved access roles and archive channel. Disabling creation does not remove existing tickets.

Neutral branding and messages are editable through documented `{placeholders}`. Normal and high cooldowns can be disabled explicitly; quotas have their own module switch. NA/EU/AS can be enabled individually. The tier-list module requires all five list channels.

## Testing and support

Verification validates an account's existence and UUID, then links it to the Discord player. It is not proof of Minecraft account ownership. Rank/history stay with the Discord ID after staff unlink an account.

Normal queue tests open in regional categories. `/passeval` records LT3 and moves the ticket to HT3 testing. HT3/LT2/HT2/LT1 players request the next high tier directly. Staff close tests with a tier or Test Discontinued. Previous Rank is captured when the ticket opens. HT3 list entry is manual; LT2 and higher list entry is automatic.

Support includes five configurable defaults and custom types. Type-specific access applies even in overflow categories. Opening messages are pinned. Only responsible staff can use the close button. Every enabled ticket type requires an archive channel.

## Archives and recovery

Closure locks the channel and saves work in a durable queue. Required transcript/image archival must succeed before deletion. Failed operations remain saved and retry with backoff; the operational log reports failures. Result posts use a persisted reference and Discord nonce to recover from uncertain sends.

Images from reports/appeals are copied by default, videos are not copied, and YouTube/attachment links remain in Markdown transcripts. Images are stored privately under `data/archives`, removed after the configured retention (default ten days), and must be accessed through authorized host access. Transcripts have no automatic expiry. Do not serve the archive folder publicly.

Current evidence limits are **25 MiB per copied image** and **8 MiB per Markdown transcript**. Oversized/failed required archives retain the channel for staff intervention. These limits need testing against your server's expected ticket volumes.

Daily portable database backups retain the latest ten successful automatic backups. Manual exports are not automatically removed. Host backups do not copy local evidence files: back up the archive directory separately if you need disaster recovery for evidence.

Owner commands: `/backup export`, `/backup restore`, `/backup transfer`. Restore/transfer require maintenance, a preview, and confirmation. Transfer writes to an empty destination, verifies its state, and keeps the source in maintenance. Stop the source process before switching configuration and starting the destination. Backups exclude credentials and runtime leases.

## Optional migration

Enable the migration module and place a standardized JSON file in `data/imports`. See `docs/MIGRATION.md`. Use `/migration preview`, correct blocking issues, then `/migration apply` in maintenance. The import is one-time; `/migration retry` reschedules saved failed operations without repeating successful database imports. Stop the old bot/database writers before any live takeover.

## Develop from source

Run `npm ci`, `npm test`, then `npm run package`. The ZIP contains compiled runtime files, not local credentials, configuration, databases, or archives. `npm run validate` checks the local configuration without connecting to Discord.

The source repository is public. Production credentials and live configuration belong only on the host and are excluded by `.gitignore`. No project license has been selected.

## Linux / PM2

From the extracted directory, install PM2 if desired and run `pm2 start dist/src/main.js --name crystal-bot --node-args="--env-file=.env"`. Set the working directory to the installation folder. Use one process, preserve its `data` directory during updates, and enable startup using PM2's instructions for your Linux distribution. Run configuration validation and create a manual backup before updating.

## Documentation sources

Runtime conventions follow the [discord.js documentation](https://discord.js.org/docs/packages/discord.js/main), [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html), [Supabase RPC documentation](https://supabase.com/docs/reference/javascript/rpc), and [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security). Dependency versions are pinned in `package-lock.json`.
