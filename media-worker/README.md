# Easy Education Media Worker

This Windows worker downloads authorized source videos, applies FFmpeg watermark presets and uploads them to the Telegram channel selected in Media Operations.

## Install

1. Open PowerShell in this folder.
2. Run `Set-ExecutionPolicy -Scope Process Bypass`.
3. Run `./install-windows.ps1`.
4. Edit `.env` and add the same `AUTOMATION_SECRET` used by Vercel plus `TELEGRAM_BOT_TOKEN`.
5. Restart PowerShell and run `./start-worker.ps1`.

## Enable videos up to 2 GB

The normal hosted Bot API accepts new uploads only up to 50 MB. For real course videos:

1. Create an application once at `https://my.telegram.org/apps` and copy its `api_id` and `api_hash`.
2. Run `./setup-local-telegram.ps1`.
3. If Docker Desktop is installed for the first time, restart Windows and run the script again.
4. The script creates `telegram-local-api/.env`; add the API ID/hash and run it once more.
5. It starts the local API on `127.0.0.1:8081` and updates the worker `.env` automatically.

The local server is bound only to localhost. It is not exposed to other computers or the public internet.

The worker processes one video at a time. You may queue ten links together. Download `.part` files and completed input files remain under `work/<task-id>` so a Windows restart can resume the task after its three-minute lease expires.

The Docker setup packages Telegram's open-source Local Bot API server using the community-maintained `aiogram/telegram-bot-api` image. The server data stays in a local Docker volume.
