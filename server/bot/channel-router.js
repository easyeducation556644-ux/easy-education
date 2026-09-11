import crypto from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminServices } from "./utils/firebase-admin.js"

const TELEGRAM_API = "https://api.telegram.org"
const CHANNELS = "telegramRouterChannels"
const ROUTES = "telegramRouterRoutes"
const STATES = "telegramRouterStates"
const ALBUMS = "telegramRouterAlbums"

let botMePromise = null

export function channelRouterToken() {
  const token = process.env.CHANNEL_ROUTER_BOT_TOKEN || ""
  if (!token) throw new Error("CHANNEL_ROUTER_BOT_TOKEN is not configured")
  return token
}

export function channelRouterWebhookSecret() {
  return crypto
    .createHash("sha256")
    .update(`easy-education-channel-router:${channelRouterToken()}`, "utf8")
    .digest("hex")
}

export async function channelRouterTelegram(method, body = {}) {
  const response = await fetch(`${TELEGRAM_API}/bot${channelRouterToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.description || `${response.status} ${response.statusText}`)
    error.telegramMethod = method
    error.telegramErrorCode = payload.error_code
    throw error
  }
  return payload.result
}

async function botMe() {
  if (!botMePromise) botMePromise = channelRouterTelegram("getMe", {})
  try {
    return await botMePromise
  } catch (error) {
    botMePromise = null
    throw error
  }
}

function kb(rows) {
  return { inline_keyboard: rows }
}

function button(text, callbackData) {
  return { text, callback_data: callbackData }
}

function rowsOf(items, width = 1) {
  const rows = []
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width))
  return rows
}

async function sendMessage(chatId, text, replyMarkup) {
  return channelRouterTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

async function editMessage(chatId, messageId, text, replyMarkup) {
  try {
    return await channelRouterTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    })
  } catch (error) {
    if (String(error.message || "").includes("message is not modified")) return null
    throw error
  }
}

async function answerCallback(id, text = "") {
  if (!id) return
  try {
    await channelRouterTelegram("answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text, show_alert: false } : {}),
    })
  } catch {
    // Callback may already be too old. Do not fail the webhook.
  }
}

function channelDocId(userId, chatId) {
  return `${userId}_${chatId}`
}

async function saveChannelForUser(userId, chat, active = true) {
  const { db } = getAdminServices()
  const ref = db.collection(CHANNELS).doc(channelDocId(userId, chat.id))
  const existing = await ref.get()
  await ref.set(
    {
      userId: String(userId),
      chatId: String(chat.id),
      title: chat.title || chat.username || String(chat.id),
      username: chat.username || null,
      type: chat.type,
      active,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )
}

async function listUserChannels(userId) {
  const { db } = getAdminServices()
  const snapshot = await db.collection(CHANNELS).where("userId", "==", String(userId)).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => item.active !== false)
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")))
}

async function getUserChannel(userId, chatId) {
  const { db } = getAdminServices()
  const doc = await db.collection(CHANNELS).doc(channelDocId(userId, chatId)).get()
  if (!doc.exists || doc.data()?.active === false) return null
  return { id: doc.id, ...doc.data() }
}

async function setState(userId, state) {
  const { db } = getAdminServices()
  await db.collection(STATES).doc(String(userId)).set(
    { ...state, updatedAt: FieldValue.serverTimestamp() },
    { merge: false },
  )
}

async function getState(userId) {
  const { db } = getAdminServices()
  const doc = await db.collection(STATES).doc(String(userId)).get()
  return doc.exists ? doc.data() : null
}

async function clearState(userId) {
  const { db } = getAdminServices()
  await db.collection(STATES).doc(String(userId)).delete().catch(() => {})
}

async function getMember(chatId, userId) {
  return channelRouterTelegram("getChatMember", { chat_id: chatId, user_id: userId })
}

function isAdminMember(member) {
  return member && ["administrator", "creator"].includes(member.status)
}

async function verifyChannelAccess(userId, chatId, { destination = false } = {}) {
  const me = await botMe()
  const [userMember, botMember] = await Promise.all([
    getMember(chatId, userId),
    getMember(chatId, me.id),
  ])
  if (!isAdminMember(userMember)) throw new Error("You are no longer an admin of this channel.")
  if (!isAdminMember(botMember)) throw new Error("The bot is no longer an admin of this channel.")
  if (destination && botMember.status === "administrator" && botMember.can_post_messages === false) {
    throw new Error("The bot needs permission to post messages in the destination channel.")
  }
  return true
}

function homeKeyboard() {
  return kb([
    [button("➕ Create route", "menu:create")],
    [button("🔗 My routes", "menu:routes"), button("📢 My channels", "menu:channels")],
    [button("ℹ️ Help", "menu:help")],
  ])
}

function homeText() {
  return [
    "<b>Channel Router</b>",
    "",
    "Automatically copy or forward new posts between Telegram channels you manage.",
    "",
    "Add this bot as an <b>admin</b> in both source and destination channels first, then create a route here.",
  ].join("\n")
}

async function renderHome(chatId, messageId) {
  const text = homeText()
  if (messageId) return editMessage(chatId, messageId, text, homeKeyboard())
  return sendMessage(chatId, text, homeKeyboard())
}

async function renderChannels(userId, chatId, messageId) {
  const channels = await listUserChannels(userId)
  const lines = ["<b>📢 My channels</b>", ""]
  if (!channels.length) {
    lines.push("No channels detected yet.")
    lines.push("", "Add this bot as an <b>administrator</b> to a Telegram channel. I will detect it automatically.")
  } else {
    channels.forEach((channel, index) => {
      lines.push(`${index + 1}. <b>${escapeHtml(channel.title)}</b>${channel.username ? ` (@${escapeHtml(channel.username)})` : ""}`)
    })
    lines.push("", "To add more, promote the bot to admin in another channel.")
  }
  return editMessage(chatId, messageId, lines.join("\n"), kb([[button("⬅️ Back", "menu:home")]]))
}

async function renderCreateSource(userId, chatId, messageId) {
  const channels = await listUserChannels(userId)
  if (channels.length < 2) {
    return editMessage(
      chatId,
      messageId,
      "<b>Need at least two channels</b>\n\nAdd the bot as admin to the source and destination channels first.",
      kb([[button("📢 View channels", "menu:channels")], [button("⬅️ Back", "menu:home")]]),
    )
  }
  await setState(userId, { stage: "source" })
  const buttons = channels.map((channel) => button(`📥 ${truncate(channel.title, 42)}`, `src:${channel.chatId}`))
  return editMessage(
    chatId,
    messageId,
    "<b>Create route</b>\n\nChoose the <b>source</b> channel:",
    kb([...rowsOf(buttons, 1), [button("❌ Cancel", "menu:home")]]),
  )
}

async function renderDestinationPicker(userId, chatId, messageId) {
  const state = await getState(userId)
  if (!state?.sourceChatId) return renderCreateSource(userId, chatId, messageId)
  const channels = await listUserChannels(userId)
  const selected = new Set((state.destinationChatIds || []).map(String))
  const choices = channels.filter((channel) => String(channel.chatId) !== String(state.sourceChatId))
  const buttons = choices.map((channel) =>
    button(`${selected.has(String(channel.chatId)) ? "✅" : "⬜"} ${truncate(channel.title, 38)}`, `dst:${channel.chatId}`),
  )
  return editMessage(
    chatId,
    messageId,
    `<b>Select destination channels</b>\n\nSelected: <b>${selected.size}</b>\nYou can choose multiple destinations.`,
    kb([
      ...rowsOf(buttons, 1),
      [button("Continue ➜", "dst:done")],
      [button("⬅️ Change source", "menu:create"), button("❌ Cancel", "menu:home")],
    ]),
  )
}

async function renderModePicker(userId, chatId, messageId) {
  const state = await getState(userId)
  if (!state?.sourceChatId || !(state.destinationChatIds || []).length) {
    return renderCreateSource(userId, chatId, messageId)
  }
  await setState(userId, { ...state, stage: "mode" })
  return editMessage(
    chatId,
    messageId,
    [
      "<b>Choose delivery mode</b>",
      "",
      "<b>Copy/Post</b> — destination receives a fresh post without the forwarded label.",
      "<b>Forward</b> — Telegram's normal forwarded message, with source attribution where Telegram allows it.",
    ].join("\n"),
    kb([
      [button("📝 Copy / Post", "mode:copy")],
      [button("↗️ Forward", "mode:forward")],
      [button("⬅️ Destinations", "dst:back"), button("❌ Cancel", "menu:home")],
    ]),
  )
}

async function listUserRoutes(userId) {
  const { db } = getAdminServices()
  const snapshot = await db.collection(ROUTES).where("ownerUserId", "==", String(userId)).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
}

async function getRoute(routeId) {
  const { db } = getAdminServices()
  const doc = await db.collection(ROUTES).doc(routeId).get()
  return doc.exists ? { id: doc.id, ...doc.data() } : null
}

async function renderRoutes(userId, chatId, messageId) {
  const routes = await listUserRoutes(userId)
  if (!routes.length) {
    return editMessage(
      chatId,
      messageId,
      "<b>🔗 My routes</b>\n\nNo routes yet. Create your first source → destination mapping.",
      kb([[button("➕ Create route", "menu:create")], [button("⬅️ Back", "menu:home")]]),
    )
  }
  const { db } = getAdminServices()
  const buttons = []
  for (const route of routes.slice(0, 20)) {
    const source = await lookupChannelTitle(db, route.ownerUserId, route.sourceChatId)
    const destinations = await Promise.all((route.destinationChatIds || []).map((id) => lookupChannelTitle(db, route.ownerUserId, id)))
    const status = route.enabled === false ? "⏸" : "🟢"
    buttons.push([button(`${status} ${truncate(source, 18)} → ${truncate(destinations.join(", "), 25)}`, `route:${route.id}`)])
  }
  buttons.push([button("➕ Create route", "menu:create")], [button("⬅️ Back", "menu:home")])
  return editMessage(chatId, messageId, "<b>🔗 My routes</b>\n\nTap a route to manage it:", kb(buttons))
}

async function renderRouteDetail(userId, routeId, chatId, messageId) {
  const route = await getRoute(routeId)
  if (!route || String(route.ownerUserId) !== String(userId)) throw new Error("Route not found.")
  const { db } = getAdminServices()
  const source = await lookupChannelTitle(db, userId, route.sourceChatId)
  const destinations = await Promise.all((route.destinationChatIds || []).map((id) => lookupChannelTitle(db, userId, id)))
  const text = [
    "<b>Route details</b>",
    "",
    `Source: <b>${escapeHtml(source)}</b>`,
    `Destination${destinations.length === 1 ? "" : "s"}: <b>${escapeHtml(destinations.join(", "))}</b>`,
    `Mode: <b>${route.mode === "forward" ? "Forward" : "Copy / Post"}</b>`,
    `Status: <b>${route.enabled === false ? "Paused" : "Active"}</b>`,
    "",
    `Sent: <b>${Number(route.sentCount || 0)}</b>`,
    `Failed: <b>${Number(route.failedCount || 0)}</b>`,
    route.lastError ? `Last error: <code>${escapeHtml(truncate(route.lastError, 180))}</code>` : "",
  ].filter(Boolean).join("\n")
  return editMessage(
    chatId,
    messageId,
    text,
    kb([
      [button(route.enabled === false ? "▶️ Resume" : "⏸ Pause", `toggle:${route.id}`)],
      [button("🗑 Delete", `delete:${route.id}`)],
      [button("⬅️ My routes", "menu:routes")],
    ]),
  )
}

async function lookupChannelTitle(db, userId, chatId) {
  const doc = await db.collection(CHANNELS).doc(channelDocId(userId, chatId)).get()
  return doc.exists ? (doc.data()?.title || String(chatId)) : String(chatId)
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function truncate(value, max) {
  const text = String(value || "")
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

async function wouldCreateCycle(sourceChatId, destinationChatIds) {
  const { db } = getAdminServices()
  const snapshot = await db.collection(ROUTES).where("enabled", "==", true).get()
  const graph = new Map()
  const addEdge = (from, to) => {
    const key = String(from)
    if (!graph.has(key)) graph.set(key, new Set())
    graph.get(key).add(String(to))
  }
  snapshot.docs.forEach((doc) => {
    const route = doc.data()
    ;(route.destinationChatIds || []).forEach((dest) => addEdge(route.sourceChatId, dest))
  })
  destinationChatIds.forEach((dest) => addEdge(sourceChatId, dest))

  const visiting = new Set()
  const visited = new Set()
  const dfs = (node) => {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of graph.get(node) || []) {
      if (dfs(next)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }
  for (const node of graph.keys()) {
    if (dfs(node)) return true
  }
  return false
}

async function createRoute(userId, mode) {
  const state = await getState(userId)
  if (!state?.sourceChatId || !(state.destinationChatIds || []).length) throw new Error("Route setup expired. Please start again.")
  const sourceChatId = String(state.sourceChatId)
  const destinationChatIds = [...new Set(state.destinationChatIds.map(String))].filter((id) => id !== sourceChatId)
  if (!destinationChatIds.length) throw new Error("Choose at least one destination channel.")

  const sourceRecord = await getUserChannel(userId, sourceChatId)
  if (!sourceRecord) throw new Error("Source channel is no longer available.")
  await verifyChannelAccess(userId, sourceChatId)
  for (const destinationChatId of destinationChatIds) {
    const record = await getUserChannel(userId, destinationChatId)
    if (!record) throw new Error("A destination channel is no longer available.")
    await verifyChannelAccess(userId, destinationChatId, { destination: true })
  }
  if (await wouldCreateCycle(sourceChatId, destinationChatIds)) {
    throw new Error("This route would create a forwarding loop. Choose different channels.")
  }

  const existing = await listUserRoutes(userId)
  const signature = [...destinationChatIds].sort().join(",")
  const duplicate = existing.find((route) =>
    String(route.sourceChatId) === sourceChatId &&
    [...(route.destinationChatIds || []).map(String)].sort().join(",") === signature &&
    route.mode === mode,
  )
  if (duplicate) throw new Error("This route already exists.")

  const { db } = getAdminServices()
  const now = Date.now()
  const ref = await db.collection(ROUTES).add({
    ownerUserId: String(userId),
    sourceChatId,
    destinationChatIds,
    mode: mode === "forward" ? "forward" : "copy",
    enabled: true,
    sentCount: 0,
    failedCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await clearState(userId)
  return ref.id
}

async function toggleRoute(userId, routeId) {
  const route = await getRoute(routeId)
  if (!route || String(route.ownerUserId) !== String(userId)) throw new Error("Route not found.")
  const nextEnabled = route.enabled === false
  if (nextEnabled && await wouldCreateCycle(route.sourceChatId, route.destinationChatIds || [])) {
    throw new Error("Cannot resume because it would create a forwarding loop.")
  }
  const { db } = getAdminServices()
  await db.collection(ROUTES).doc(routeId).update({ enabled: nextEnabled, updatedAt: FieldValue.serverTimestamp() })
}

async function deleteRoute(userId, routeId) {
  const route = await getRoute(routeId)
  if (!route || String(route.ownerUserId) !== String(userId)) throw new Error("Route not found.")
  const { db } = getAdminServices()
  await db.collection(ROUTES).doc(routeId).delete()
}

async function routesForSource(sourceChatId) {
  const { db } = getAdminServices()
  const snapshot = await db.collection(ROUTES).where("sourceChatId", "==", String(sourceChatId)).get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((route) => route.enabled !== false)
}

async function recordRouteSuccess(routeId, count = 1) {
  const { db } = getAdminServices()
  await db.collection(ROUTES).doc(routeId).set({
    sentCount: FieldValue.increment(count),
    lastForwardAt: FieldValue.serverTimestamp(),
    lastError: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function recordRouteFailure(routeId, error) {
  const { db } = getAdminServices()
  await db.collection(ROUTES).doc(routeId).set({
    failedCount: FieldValue.increment(1),
    lastError: truncate(error?.message || String(error), 500),
    lastFailedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function deliverSinglePost(message) {
  const routes = await routesForSource(message.chat.id)
  if (!routes.length) return
  await Promise.all(routes.map(async (route) => {
    let successes = 0
    let firstError = null
    await Promise.all((route.destinationChatIds || []).map(async (destinationChatId) => {
      try {
        const method = route.mode === "forward" ? "forwardMessage" : "copyMessage"
        await channelRouterTelegram(method, {
          chat_id: destinationChatId,
          from_chat_id: message.chat.id,
          message_id: message.message_id,
        })
        successes += 1
      } catch (error) {
        firstError ||= error
      }
    }))
    if (successes > 0) await recordRouteSuccess(route.id, 1)
    if (firstError) await recordRouteFailure(route.id, firstError)
  }))
}

function albumDocId(sourceChatId, mediaGroupId) {
  return crypto.createHash("sha1").update(`${sourceChatId}:${mediaGroupId}`).digest("hex")
}

async function bufferAlbumMessage(message) {
  const { db } = getAdminServices()
  const ref = db.collection(ALBUMS).doc(albumDocId(message.chat.id, message.media_group_id))
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    const current = snap.exists ? snap.data() : {}
    const ids = new Set((current.messageIds || []).map(Number))
    ids.add(Number(message.message_id))
    transaction.set(ref, {
      sourceChatId: String(message.chat.id),
      mediaGroupId: String(message.media_group_id),
      messageIds: [...ids].sort((a, b) => a - b),
      lastUpdatedAtMs: Date.now(),
      claimed: false,
    }, { merge: true })
  })

  await new Promise((resolve) => setTimeout(resolve, 1500))

  let batch = null
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists) return
    const data = snap.data()
    if (data.claimed) return
    if (Date.now() - Number(data.lastUpdatedAtMs || 0) < 900) return
    transaction.update(ref, { claimed: true, claimedAtMs: Date.now() })
    batch = data
  })
  if (!batch) return

  try {
    const routes = await routesForSource(batch.sourceChatId)
    const messageIds = [...new Set((batch.messageIds || []).map(Number))].sort((a, b) => a - b)
    await Promise.all(routes.map(async (route) => {
      let successes = 0
      let firstError = null
      await Promise.all((route.destinationChatIds || []).map(async (destinationChatId) => {
        try {
          const method = route.mode === "forward" ? "forwardMessages" : "copyMessages"
          await channelRouterTelegram(method, {
            chat_id: destinationChatId,
            from_chat_id: batch.sourceChatId,
            message_ids: messageIds,
          })
          successes += 1
        } catch (error) {
          firstError ||= error
        }
      }))
      if (successes > 0) await recordRouteSuccess(route.id, messageIds.length)
      if (firstError) await recordRouteFailure(route.id, firstError)
    }))
  } finally {
    await ref.delete().catch(() => {})
  }
}

async function handleChannelMembership(update) {
  const event = update.my_chat_member
  if (!event || event.chat?.type !== "channel" || !event.from?.id) return
  const status = event.new_chat_member?.status
  const active = status === "administrator" || status === "creator"
  await saveChannelForUser(event.from.id, event.chat, active)
  if (active) {
    await sendMessage(
      event.from.id,
      `<b>Channel connected ✅</b>\n\n${escapeHtml(event.chat.title || String(event.chat.id))} is ready to use in routes.`,
      homeKeyboard(),
    ).catch(() => {})
  }
}

async function handlePrivateMessage(message) {
  if (!message?.from?.id || message.chat?.type !== "private") return
  const userId = message.from.id
  const text = String(message.text || "").trim()
  if (text.startsWith("/cancel")) {
    await clearState(userId)
    return sendMessage(message.chat.id, "Cancelled.", homeKeyboard())
  }
  if (text.startsWith("/start") || text === "/menu") {
    await clearState(userId)
    return renderHome(message.chat.id)
  }
  return sendMessage(message.chat.id, "Use the menu below to manage your channel routes.", homeKeyboard())
}

async function handleCallback(query) {
  const userId = query.from?.id
  const message = query.message
  if (!userId || !message?.chat?.id || !message.message_id) return
  const chatId = message.chat.id
  const messageId = message.message_id
  const data = String(query.data || "")
  await answerCallback(query.id)

  try {
    if (data === "menu:home") {
      await clearState(userId)
      return renderHome(chatId, messageId)
    }
    if (data === "menu:channels") return renderChannels(userId, chatId, messageId)
    if (data === "menu:create") return renderCreateSource(userId, chatId, messageId)
    if (data === "menu:routes") return renderRoutes(userId, chatId, messageId)
    if (data === "menu:help") {
      return editMessage(
        chatId,
        messageId,
        [
          "<b>How it works</b>",
          "",
          "1. Add this bot as admin in every source and destination channel.",
          "2. Return here and tap <b>Create route</b>.",
          "3. Pick one source and one or more destinations.",
          "4. Choose Copy/Post or Forward.",
          "",
          "Protected-content restrictions are respected. If Telegram blocks copying/forwarding for a post, the route records the failure instead of bypassing it.",
        ].join("\n"),
        kb([[button("⬅️ Back", "menu:home")]]),
      )
    }
    if (data.startsWith("src:")) {
      const sourceChatId = data.slice(4)
      const channel = await getUserChannel(userId, sourceChatId)
      if (!channel) throw new Error("Channel not found. Please add the bot as admin again.")
      await verifyChannelAccess(userId, sourceChatId)
      await setState(userId, { stage: "destinations", sourceChatId, destinationChatIds: [] })
      return renderDestinationPicker(userId, chatId, messageId)
    }
    if (data.startsWith("dst:") && data !== "dst:done" && data !== "dst:back") {
      const destinationChatId = data.slice(4)
      const state = await getState(userId)
      if (!state?.sourceChatId) return renderCreateSource(userId, chatId, messageId)
      if (String(destinationChatId) === String(state.sourceChatId)) throw new Error("Source cannot also be a destination.")
      const selected = new Set((state.destinationChatIds || []).map(String))
      if (selected.has(String(destinationChatId))) selected.delete(String(destinationChatId))
      else selected.add(String(destinationChatId))
      await setState(userId, { ...state, stage: "destinations", destinationChatIds: [...selected] })
      return renderDestinationPicker(userId, chatId, messageId)
    }
    if (data === "dst:done") {
      const state = await getState(userId)
      if (!(state?.destinationChatIds || []).length) {
        await answerCallback(query.id, "Choose at least one destination")
        return
      }
      return renderModePicker(userId, chatId, messageId)
    }
    if (data === "dst:back") return renderDestinationPicker(userId, chatId, messageId)
    if (data === "mode:copy" || data === "mode:forward") {
      const routeId = await createRoute(userId, data.endsWith("forward") ? "forward" : "copy")
      await editMessage(
        chatId,
        messageId,
        "<b>Route created ✅</b>\n\nNew posts from the source channel will now be delivered automatically.",
        kb([[button("View route", `route:${routeId}`)], [button("🏠 Main menu", "menu:home")]]),
      )
      return
    }
    if (data.startsWith("route:")) return renderRouteDetail(userId, data.slice(6), chatId, messageId)
    if (data.startsWith("toggle:")) {
      const routeId = data.slice(7)
      await toggleRoute(userId, routeId)
      return renderRouteDetail(userId, routeId, chatId, messageId)
    }
    if (data.startsWith("delete:")) {
      const routeId = data.slice(7)
      const route = await getRoute(routeId)
      if (!route || String(route.ownerUserId) !== String(userId)) throw new Error("Route not found.")
      return editMessage(
        chatId,
        messageId,
        "<b>Delete this route?</b>\n\nThis stops automatic delivery for this mapping.",
        kb([[button("Yes, delete", `confirmdelete:${routeId}`)], [button("Cancel", `route:${routeId}`)]]),
      )
    }
    if (data.startsWith("confirmdelete:")) {
      await deleteRoute(userId, data.slice(14))
      return renderRoutes(userId, chatId, messageId)
    }
  } catch (error) {
    console.error("Channel router callback failed:", error)
    await answerCallback(query.id, truncate(error?.message || "Something went wrong", 180))
    return editMessage(
      chatId,
      messageId,
      `<b>Could not complete that action</b>\n\n${escapeHtml(error?.message || "Please try again.")}`,
      kb([[button("⬅️ Main menu", "menu:home")]]),
    ).catch(() => {})
  }
}

function validWebhookRequest(req) {
  const supplied = String(req.headers["x-telegram-bot-api-secret-token"] || "")
  const expected = channelRouterWebhookSecret()
  if (!supplied || supplied.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"])
    return res.status(405).json({ ok: false })
  }

  try {
    if (!validWebhookRequest(req)) return res.status(401).json({ ok: false })
    const update = req.body || {}

    if (update.my_chat_member) await handleChannelMembership(update)
    else if (update.callback_query) await handleCallback(update.callback_query)
    else if (update.channel_post) {
      if (update.channel_post.media_group_id) await bufferAlbumMessage(update.channel_post)
      else await deliverSinglePost(update.channel_post)
    } else if (update.message) await handlePrivateMessage(update.message)

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error("Channel router webhook failed:", error)
    return res.status(200).json({ ok: true })
  }
}
