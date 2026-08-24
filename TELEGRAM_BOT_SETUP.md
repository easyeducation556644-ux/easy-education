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

Udvash is hardcoded to the captured official web flow. No Udvash endpoint environment variables are required.

Authentication:

`GET /Account/Password` (or login page fallback) -> fresh ASP.NET anti-forgery token/cookie -> `POST /Account/Login` using `RegistrationNumber`, `Password`, `RememberMe`, `returnUrl`, and `__RequestVerificationToken`.

Content crawl:

`/Content/Index?id=2` -> Course -> Subject -> Chapter -> Content Type -> Class.

The bot performs a fresh Udvash login before reading a selected account's courses/content. Direct signed media URLs are intentionally not stored during EE UP; the later media worker will fetch fresh class details just before download.

Optional only if Udvash later rejects the default browser signature:

```text
UDVASH_USER_AGENT=Mozilla/5.0 ...
```

## 5. Bot flow

### Accounts

`Accounts` -> `Add account` -> `Udvash` -> label -> roll -> password.

The password is encrypted using AES-256-GCM before Firestore storage. The bot attempts to delete the Telegram password message after processing it. A successful login also verifies the account by fetching the current course list.

The Accounts screen shows every saved account with a delete button. Delete requires confirmation. Deleting an account removes its saved credential/session record, but does not delete classes already imported into Easy-Education.

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
- Every imported class includes source metadata such as `sourcePlatform`, `sourceCourseId`, `sourceClassId`, `sourceContentId`, `sourceContentTypeId`, `sourceSubjectId`, `sourceChapterId`, `sourceSubject`, and `sourceChapter`.

New imported classes are created with `isPublished:false`, `mediaStatus:waiting_worker`, and no playable video URL. Therefore students do not see them before the later phone/PC download worker finishes the media step.

### TG UP

The `TG UP` button exists but currently shows the worker placeholder, as planned. The later worker can consume the already-created `botJobs` records.
