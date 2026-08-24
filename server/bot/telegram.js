const TELEGRAM_API = "https://api.telegram.org"

export function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured")
  return token
}

export function adminIds() {
  return new Set(
    String(process.env.TELEGRAM_ADMIN_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

export function isAllowedTelegramUser(userId) {
  const allowed = adminIds()
  return allowed.size > 0 && allowed.has(String(userId))
}

export async function telegram(method, body = {}) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    const description = payload.description || `${response.status} ${response.statusText}`
    throw new Error(`Telegram ${method} failed: ${description}`)
  }
  return payload.result
}

export async function sendMessage(chatId, text, replyMarkup) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

export async function editMessage(chatId, messageId, text, replyMarkup) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

export async function answerCallback(callbackQueryId, text = "") {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  })
}

export async function deleteMessage(chatId, messageId) {
  try {
    return await telegram("deleteMessage", { chat_id: chatId, message_id: messageId })
  } catch {
    return false
  }
}

export function keyboard(rows) {
  return { inline_keyboard: rows }
}

export function button(text, callbackData) {
  return { text, callback_data: callbackData }
}

export function mainMenu() {
  return keyboard([
    [button("📥 EE UP", "mode:ee"), button("📤 TG UP", "mode:tg")],
    [button("👤 Accounts", "account:list"), button("📊 Status", "status")],
  ])
}
