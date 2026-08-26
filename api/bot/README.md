# Easy Education Content Operations Bot

The Telegram bot is a private administration interface for importing and maintaining course content. The production endpoint is `api/telegram-bot.js`; supporting code remains under `server/bot` so the Vercel Hobby function count stays within its limit.

## Security

Required server-side variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_IDS`
- `TELEGRAM_WEBHOOK_SECRET`
- `BOT_SETUP_SECRET`
- `BOT_CREDENTIAL_KEY`
- `PUBLIC_APP_URL`
- `AUTOMATION_SECRET`

The webhook rejects requests when `TELEGRAM_WEBHOOK_SECRET` is absent. Source passwords, source cookies, Google refresh tokens, and OAuth state are protected by server-only secrets.

## Google Drive setup

1. Create a Google Cloud project and enable Google Drive API.
2. Configure the OAuth consent screen.
3. Create a Web application OAuth client.
4. Add this exact authorized redirect URI:
   `https://YOUR_PRODUCTION_DOMAIN/api/google-drive/callback`
5. Configure `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`, and `GOOGLE_DRIVE_STATE_SECRET` in Vercel.
6. Open **Storage** in Telegram and connect one or more Google accounts.

Each account receives an `Easy Education Content` root folder. Before every upload, the bot refreshes storage quota. A full account is flagged, the next usable account is promoted, and that account becomes the default.

## GitHub Actions scheduler

`.github/workflows/content-automation.yml` calls the protected automation endpoint every 30 minutes. Configure these GitHub Actions repository secrets:

- `AUTOMATION_ENDPOINT` — production origin, for example `https://example.com`
- `AUTOMATION_SECRET` — the same value configured in Vercel

Administrators select schedules from Telegram; they never enter cron syntax. Times use `Asia/Dhaka` and support overall defaults plus platform-specific overrides.

## Server-only Firestore collections

- `botSessions` — Telegram conversation state.
- `botPlatformAccounts` — encrypted source account credentials and sessions.
- `botStorageAccounts` — encrypted Google OAuth credentials and quota status.
- `botStoredAssets` — source-to-Drive asset records and repair status.
- `botSourceSnapshots` — chunked source course snapshots.
- `botCourseMappings` — mappings used by automation.
- `botAutomationSettings` — overall and platform schedules.
- `botJobs` — scheduled sync, Drive repair, and media-processing jobs.

These collections remain behind Firestore's default-deny client rule and are accessed through Firebase Admin only.
