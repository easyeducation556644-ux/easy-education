import { botToken, telegram } from "../server/bot/telegram.js"

function expectedSetupSecret() {
  return process.env.BOT_SETUP_SECRET || ""
}

function requestedSetupSecret(req) {
  return req.headers["x-setup-secret"] || ""
}

function webhookUrl(req) {
  if (process.env.TELEGRAM_WEBHOOK_URL) return process.env.TELEGRAM_WEBHOOK_URL
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim()
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim()
  if (!host) throw new Error("Unable to determine public host. Set TELEGRAM_WEBHOOK_URL.")
  return `${proto}://${host}/api/telegram-bot`
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"])
    return res.status(405).json({ ok: false, error: "Method Not Allowed" })
  }

  const expected = expectedSetupSecret()
  if (!expected) return res.status(500).json({ ok: false, error: "BOT_SETUP_SECRET is not configured" })
  if (requestedSetupSecret(req) !== expected) return res.status(401).json({ ok: false, error: "Invalid setup secret" })

  try {
    botToken()
    const url = webhookUrl(req)
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || undefined
    const webhook = await telegram("setWebhook", {
      url,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      ...(secretToken ? { secret_token: secretToken } : {}),
    })
    await telegram("setMyCommands", {
      commands: [
        { command: "start", description: "Open main menu" },
        { command: "accounts", description: "Manage source accounts" },
        { command: "status", description: "Show bot queue status" },
        { command: "cancel", description: "Cancel current flow" },
      ],
    })
    const me = await telegram("getMe", {})
    return res.status(200).json({
      ok: true,
      webhook,
      webhookUrl: url,
      bot: { id: me.id, username: me.username, firstName: me.first_name },
      openTelegram: me.username ? `https://t.me/${me.username}` : null,
    })
  } catch (error) {
    console.error("Telegram setup failed:", error)
    return res.status(500).json({ ok: false, error: error.message || "Telegram setup failed" })
  }
}
