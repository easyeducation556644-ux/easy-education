import { createHash } from "node:crypto"

export function mediaId(...parts) {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex").slice(0, 32)
}

export function validSourceUrl(value) {
  const url = new URL(String(value ?? "").trim().slice(0, 3000))
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP or HTTPS video links are supported")
  return url.toString()
}
