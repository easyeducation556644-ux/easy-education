# Easy Education Media Worker

This Windows worker downloads authorized source videos, applies FFmpeg watermark presets and uploads them to the Telegram channel selected in Media Operations.

## Install

1. Open PowerShell in this folder.
2. Run `Set-ExecutionPolicy -Scope Process Bypass`.
3. Run `./install-windows.ps1`.
4. Edit `.env` and add the same `AUTOMATION_SECRET` used by Vercel plus `TELEGRAM_BOT_TOKEN`.
5. Restart PowerShell and run `./start-worker.ps1`.

The worker processes one video at a time. You may queue ten links together. Download `.part` files and completed input files remain under `work/<task-id>` so a Windows restart can resume the task after its three-minute lease expires.

The hosted Bot API accepts new video uploads up to 50 MB. For larger videos, run Telegram's Local Bot API server and set `TELEGRAM_API_BASE_URL` to its local URL; Local Bot API supports uploads up to 2,000 MB.
