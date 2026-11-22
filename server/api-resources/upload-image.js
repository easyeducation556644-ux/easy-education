// Authenticated ImgBB upload proxy. The provider key must only exist in server env.
// Prevent unauthenticated uploads, huge payloads, and repeated API/key abuse.
import { requireAuthenticatedUser } from "./utils/firebase-admin.js";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 12;

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function inspectImage(value) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) {
    throw httpError("Image too large or invalid (3MB maximum)", 413);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw httpError("Image must be base64", 400);
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) {
    throw httpError("Image too large or invalid (3MB maximum)", 413);
  }
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const isGif = bytes.length > 6 && (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a");
  const isWebp = bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!isJpeg && !isPng && !isGif && !isWebp) {
    throw httpError("Only JPEG, PNG, GIF and WebP images are supported", 400);
  }
  return bytes;
}

async function enforceQuota(db, uid) {
  const ref = db.collection("apiImageUploadQuotas").doc(uid);
  const windowStart = Math.floor(Date.now() / 3600000) * 3600000;
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const data = current.exists ? current.data() : {};
    const count = data.windowStart === windowStart ? Number(data.count || 0) : 0;
    if (count >= MAX_UPLOADS_PER_HOUR) {
      throw httpError("Image upload limit reached. Try again later.", 429);
    }
    transaction.set(ref, { windowStart, count: count + 1, updatedAtMs: Date.now() }, { merge: true });
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const key = process.env.IMGBB_API_KEY;
    if (!key) {
      console.error("Image upload: IMGBB_API_KEY is not configured");
      throw httpError("Image service unavailable", 503);
    }
    const bytes = inspectImage(req.body?.image);
    const { decodedToken, db } = await requireAuthenticatedUser(req);
    await enforceQuota(db, decodedToken.uid);

    const formData = new URLSearchParams();
    formData.set("image", bytes.toString("base64"));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const upstream = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
        signal: controller.signal,
      });
      const response = await upstream.json();
      if (!upstream.ok || !response?.success || !response?.data?.url) {
        throw httpError("Image provider failed", 502);
      }
      return res.status(200).json({
        success: true,
        url: response.data.url,
        display_url: response.data.display_url || response.data.url,
        provider: "imgbb",
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const status = error.statusCode || 502;
    console.error("Image upload rejected:", error.statusCode || error.code || "UPSTREAM");
    return res.status(status).json({
      success: false,
      error: error.statusCode ? error.message : "Image upload failed. Please retry.",
    });
  }
}
