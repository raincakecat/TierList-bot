# Full package

[Download full-package.zip](./full-package.zip) for compiled runtime files, source, tests, configuration templates, launchers, and a thorough PDF setup guide. Dependencies are installed after extraction; Node.js is not bundled.

[Read the PDF setup guide](../docs/Full-Setup-Guide.pdf) or its [editable Markdown source](../docs/full-setup-guide.md).

Extract the ZIP, open Full-Setup-Guide.pdf, then install Node.js 24.17.0 or newer and run `npm ci --omit=dev` inside the extracted `full-package` directory. Configure your own Discord bot/server and database before running `npm start`.

Local credentials, live configuration, databases, and evidence are excluded. This is the 0.2.0 implementation candidate with staff LOA requests/approvals/timed roles, a branded portal and roster, Discord setup wizard, private health checks, recovery fencing, and updated pagination/retention. Live Discord and remote database rehearsal remain necessary.

To rebuild from source: run `npm ci`, `npm test`, optionally regenerate the PDF with `python scripts/build-setup-guide.py` (requires ReportLab), then `node scripts/full-package.mjs`. An optional output directory argument copies the ZIP and PDF there.

October 28 update: includes the queue-ping lifecycle, cooldown reset role, ticket closure requests, channel links, multipart archives and remote-state optimizations. All 169 tests pass. See [update notes](../docs/UPDATES-2026-10-28.md).
