# Bot backend collections

The Telegram controller uses Firebase Admin, so these server-only collections stay behind the existing Firestore default-deny rule:

- `botSessions` — short-lived conversation state keyed by Telegram chat ID.
- `botPlatformAccounts` — source account metadata plus AES-GCM encrypted password/cookie/token fields.
- `botCourseMappings` — source course to Easy-Education course mapping and last comparison counts.
- `botJobs` — future phone/PC media worker queue. EE UP currently creates `media_download` jobs with `waiting_worker` status.

Imported class records are written to the existing `classes` collection. New bot imports start with `isPublished:false` and `mediaStatus:waiting_worker` so the student UI does not expose a class before its media is ready.
