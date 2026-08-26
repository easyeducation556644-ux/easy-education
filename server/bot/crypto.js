import crypto from "node:crypto"

function credentialKey() {
  const raw = process.env.BOT_CREDENTIAL_KEY || ""
  if (!raw) {
    const error = new Error("BOT_CREDENTIAL_KEY is not configured")
    error.code = "BOT_SETUP_REQUIRED"
    throw error
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest()
}

function stateKey() {
  const raw = process.env.GOOGLE_DRIVE_STATE_SECRET || process.env.BOT_CREDENTIAL_KEY || ""
  if (!raw) throw new Error("GOOGLE_DRIVE_STATE_SECRET is not configured")
  return crypto.createHash("sha256").update(raw, "utf8").digest()
}

export function encryptSecret(value) {
  if (!value) return ""
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`
}

export function decryptSecret(payload) {
  if (!payload) return ""
  const [version, ivText, tagText, encryptedText] = String(payload).split(".")
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Unsupported encrypted credential format")
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    credentialKey(),
    Buffer.from(ivText, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tagText, "base64url"))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ])
  return decrypted.toString("utf8")
}

export function stableId(...parts) {
  return crypto
    .createHash("sha1")
    .update(parts.filter(Boolean).map(String).join("\u001f"), "utf8")
    .digest("hex")
}

export function createSignedState(payload, ttlSeconds = 900) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url")
  const signature = crypto.createHmac("sha256", stateKey()).update(body).digest("base64url")
  return `${body}.${signature}`
}

export function verifySignedState(value) {
  const [body, signature] = String(value || "").split(".")
  if (!body || !signature) throw new Error("Invalid or expired connection request")
  const expected = crypto.createHmac("sha256", stateKey()).update(body).digest()
  const supplied = Buffer.from(signature, "base64url")
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw new Error("Invalid or expired connection request")
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Connection request expired")
  return payload
}
