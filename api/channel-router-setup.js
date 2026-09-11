import {
  channelRouterTelegram,
  channelRouterToken,
  channelRouterWebhookSecret,
} from "./channel-router-bot.js"

function publicWebhookUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim()
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim()
  if (!host) throw new Error("Unable to determine public deployment host")
  return `${proto}://${host}/api/channel-router-bot`
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", ["GET", "POST"])
    return res.status(405).json({ ok: false, error: "Method Not Allowed" })
  }

  try {
    channelRouterToken()
    const url = publicWebhookUrl(req)
    await channelRouterTelegram("setWebhook", {
      url,
      secret_token: channelRouterWebhookSecret(),
      allowed_updates: ["message", "callback_query", "my_chat_member", "channel_post"],
      drop_pending_updates: false,
    })
    await channelRouterTelegram("setMyCommands", {
      commands: [
        { command: "start", description: "Open channel router" },
        { command: "menu", description: "Open main menu" },
        { command: "cancel", description: "Cancel current setup" },
      ],
    })
    const me = await channelRouterTelegram("getMe", {})
    const webhookInfo = await channelRouterTelegram("getWebhookInfo", {})
    return res.status(200).json({
      ok: true,
      bot: { id: me.id, username: me.username, firstName: me.first_name },
      webhook: {
        url: webhookInfo.url,
        pendingUpdateCount: webhookInfo.pending_update_count,
        lastErrorMessage: webhookInfo.last_error_message || null,
      },
      openTelegram: me.username ? `https://t.me/${me.username}` : null,
    })
  } catch (error) {
    console.error("Channel router setup failed:", error)
    return res.status(500).json({ ok: false, error: error.message || "Setup failed" })
  }
}
