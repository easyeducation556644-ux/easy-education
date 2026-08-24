# Easy-Education Telegram Upload Bot

This bot is intentionally private: only Telegram user IDs listed in `TELEGRAM_ADMIN_IDS` can use it.

## 1. Create the bot in Telegram

1. Open Telegram and search for the verified **@BotFather** account.
2. Send `/newbot`.
3. Give the bot a display name, for example `Easy Education Upload`.
4. Give it a username ending in `bot`, for example `easy_education_upload_bot`.
5. BotFather returns a token. Keep it private. Put it in Vercel as `TELEGRAM_BOT_TOKEN`.

## 2. Required Vercel environment variables

Set these in the Easy-Education Vercel project, then redeploy:

```text
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_ADMIN_IDS=<your Telegram numeric ID; comma separate 2-3 admins>
TELEGRAM_WEBHOOK_SECRET=<long random string>
BOT_SETUP_SECRET=<another long random string>
BOT_CREDENTIAL_KEY=<long random encryption secret>
```

The existing Firebase Admin variables used by Easy-Education must also remain configured because the bot stores sessions, mappings, jobs, and encrypted account records in Firestore.

If you do not know your Telegram numeric ID yet, you can temporarily deploy with a dummy `TELEGRAM_ADMIN_IDS`, connect the webhook, open the bot, and send `/start`. The bot replies with your numeric ID when access is denied. Put that ID in `TELEGRAM_ADMIN_IDS` and redeploy.

## 3. Connect Telegram webhook

After deployment, run:

```bash
curl -X POST "https://YOUR-EASY-EDUCATION-DOMAIN/api/telegram-setup" \
  -H "x-setup-secret: YOUR_BOT_SETUP_SECRET"
```

The response includes `openTelegram`, for example `https://t.me/easy_education_upload_bot`. Open that link and press **Start**.

`/api/telegram-setup` also registers these commands automatically: `/start`, `/accounts`, `/status`, `/cancel`.

## 4. Udvash source adapter

The current repository did not contain Udvash's login/course/content API URLs, so the bot does not guess or hard-code them. Configure the actual JSON endpoints:

```text
UDVASH_LOGIN_URL=https://...
UDVASH_COURSES_URL=https://...
UDVASH_COURSE_CONTENT_URL=https://.../{courseId}
UDVASH_LOGIN_MODE=json
UDVASH_LOGIN_METHOD=POST
UDVASH_ROLL_FIELD=roll
UDVASH_PASSWORD_FIELD=password
```

Optional variables for a different API shape:

```text
UDVASH_LOGIN_MODE=form
UDVASH_COURSES_DATA_PATH=data.courses
UDVASH_CONTENT_DATA_PATH=data
UDVASH_EXTRA_HEADERS_JSON={"X-App-Version":"..."}
```

The adapter understands common JSON names for course, subject, chapter, class, lecture, video, duration, and teacher fields. If Udvash uses an unusual response shape, adjust only `api/bot/platforms/udvash.js`; the Telegram flow and EE mapping do not need to change.

## 5. Bot flow

### Accounts

`Accounts` -> `Add account` -> `Udvash` -> label -> roll -> password.

The password is encrypted using AES-256-GCM before Firestore storage. The bot attempts to delete the Telegram password message after processing it. A successful source login stores the returned cookie/token encrypted too.

### EE UP

`EE UP` -> platform -> account -> source course -> type an Easy-Education course search -> select EE course -> choose destination.

Destinations:

- `Regular`
- `Archive`
- any existing `Class Card`
- create a new Class Card from the bot, e.g. `Foundation Class`

The bot compares source classes with Easy-Education using `sourcePlatform + sourceCourseId + sourceClassId` and reports the exact source/imported/missing counts before adding anything.

Mapping rules:

- Easy-Education **batch** course: source Subject -> EE Subject, source Chapter -> EE Chapter.
- Easy-Education **subject** course: source Subject -> EE Chapter, then classes directly inside it (no extra subject level).
- Every imported class includes source metadata such as `sourcePlatform`, `sourceCourseId`, `sourceClassId`, `sourceSubject`, and `sourceChapter`.

New imported classes are created with `isPublished:false`, `mediaStatus:waiting_worker`, and no playable video URL. Therefore students do not see them before the later phone/PC download worker finishes the media step.

### TG UP

The `TG UP` button exists but currently shows the worker placeholder, as planned. The later worker can consume the already-created `botJobs` records.
