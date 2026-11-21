/*
 * Easy Education emergency recovery — CONTENT COLLECTIONS ONLY.
 *
 * This endpoint is deliberately fail-closed, disabled without explicit Vercel
 * environment settings. Firebase Admin SDK bypasses Firestore client rules.
 * Never enable "allow write: if true" for recovery.
 *
 * Vercel env required:
 * EASY_EDUCATION_RESTORE_ENABLED=true
 * EASY_EDUCATION_RESTORE_ADMIN_UIDS=<trusted Firebase Auth UIDs, comma separated>
 * EASY_EDUCATION_RESTORE_SOURCE_SHA256=<SHA-256 of the original local JSONL>
 *
 * No user/payment/access/settings/adminTokens documents are accepted.
 * Every write is Firestore DocumentReference.create(): NEVER overwrite/delete.
 */
import { Timestamp, GeoPoint } from "firebase-admin/firestore";
import { getAdminServices } from "../server/api-resources/utils/firebase-admin.js";

const PROJECT_ID = "easy-education-real";
const MAX_DOCUMENTS = 20;
const MAX_REQUEST_BYTES = 140000;
const CONTENT_COLLECTIONS = new Set(["categories", "courses", "chapters", "classes"]);
const PATH_PATTERN = /^(categories|courses|chapters|classes)\/[A-Za-z0-9_-]{1,128}$/;

function reject(res, status, error) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ success: false, error });
}

function parseTimestamp(value) {
  if (typeof value !== "string") throw Error("Invalid timestamp");
  const match = value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/);
  if (!match) throw Error("Malformed timestamp");
  const date = new Date(match[1] + match[3]);
  if (!Number.isFinite(date.getTime())) throw Error("Timestamp outside range");
  return new Timestamp(Math.floor(date.getTime() / 1000), Number((match[2] || "").padEnd(9, "0")));
}

function decodeValue(value, db, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 30)
    throw Error("Invalid Firestore value");
  const keys = Object.keys(value);
  if (keys.length !== 1) throw Error("Unexpected Firestore value type");
  const type = keys[0], v = value[type];
  if (type === "nullValue") return null;
  if (type === "stringValue") {
    if (typeof v !== "string") throw Error("Invalid string");
    return v;
  }
  if (type === "booleanValue") {
    if (typeof v !== "boolean") throw Error("Invalid boolean");
    return v;
  }
  if (type === "integerValue") {
    if (typeof v !== "string" && typeof v !== "number") throw Error("Invalid integer");
    const n = BigInt(v);
    return n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(n) : n;
  }
  if (type === "doubleValue") {
    if (v === "NaN") return NaN;
    if (v === "Infinity") return Infinity;
    if (v === "-Infinity") return -Infinity;
    const n = Number(v);
    if (Number.isNaN(n)) throw Error("Invalid double");
    return n;
  }
  if (type === "timestampValue") return parseTimestamp(v);
  if (type === "bytesValue") {
    if (typeof v !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw Error("Invalid bytes");
    return Buffer.from(v, "base64");
  }
  if (type === "referenceValue") {
    const prefix = "projects/" + PROJECT_ID + "/databases/(default)/documents/";
    if (typeof v !== "string" || !v.startsWith(prefix)) throw Error("Cross-project reference rejected");
    const path = v.slice(prefix.length);
    if (!/^([^/]+\/[^/]+)(\/[^/]+\/[^/]+)*$/.test(path)) throw Error("Invalid document reference");
    return db.doc(path);
  }
  if (type === "geoPointValue") {
    if (typeof v?.latitude !== "number" || typeof v?.longitude !== "number") throw Error("Invalid geo-point");
    return new GeoPoint(v.latitude, v.longitude);
  }
  if (type === "arrayValue") {
    if (!Array.isArray(v?.values || [])) throw Error("Invalid array");
    return (v?.values || []).map(item => decodeValue(item, db, depth + 1));
  }
  if (type === "mapValue") return decodeFields(v?.fields || {}, db, depth + 1);
  throw Error("Unsupported Firestore type: " + type);
}

function decodeFields(fields, db, depth = 0) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || depth > 30)
    throw Error("Invalid document fields");
  const output = Object.create(null);
  for (const [key, value] of Object.entries(fields)) {
    if (!key || ["__proto__", "constructor", "prototype"].includes(key)) throw Error("Unsafe field name");
    output[key] = decodeValue(value, db, depth + 1);
  }
  return output;
}

function validateBatch(rows, db) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_DOCUMENTS) throw Error("Batch must contain 1–20 documents");
  const paths = new Set();
  return rows.map(item => {
    const path = item?.path;
    if (typeof path !== "string" || !PATH_PATTERN.test(path)) throw Error("Invalid document path");
    if (paths.has(path)) throw Error("Duplicate document path");
    paths.add(path);
    if (item.hasCommittedMutations !== false) throw Error("Pending local changes excluded");
    if (item.document?.name !== "projects/" + PROJECT_ID + "/databases/(default)/documents/" + path)
      throw Error("Document path does not match backup");
    if (!CONTENT_COLLECTIONS.has(path.split("/")[0])) throw Error("Forbidden collection");
    const data = decodeFields(item.document?.fields, db);
    if (!Object.keys(data).length) throw Error("Empty document excluded");
    return { path, data };
  });
}

async function authenticate(req) {
  if (process.env.EASY_EDUCATION_RESTORE_ENABLED !== "true") {
    const err = Error("Restore is disabled in Vercel environment"); err.status = 503; throw err;
  }
  const uidList = process.env.EASY_EDUCATION_RESTORE_ADMIN_UIDS || "";
  const allowlisted = new Set(uidList.split(",").map(s => s.trim()).filter(Boolean));
  if (!allowlisted.size) {
    const err = Error("Trusted restore admin UID is not configured"); err.status = 503; throw err;
  }
  const pinnedHash = (process.env.EASY_EDUCATION_RESTORE_SOURCE_SHA256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(pinnedHash)) {
    const err = Error("Restore source SHA-256 is not configured"); err.status = 503; throw err;
  }
  const origin = req.headers.origin;
  if (origin !== "https://easy-education.vercel.app") {
    const err = Error("Requests must come from the official site"); err.status = 403; throw err;
  }
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) { const err = Error("Sign in required"); err.status = 401; throw err; }
  const { auth, db, app } = getAdminServices();
  if (app.options.projectId && app.options.projectId !== PROJECT_ID) {
    const err = Error("Wrong Firebase project"); err.status = 503; throw err;
  }
  let decoded;
  try { decoded = await auth.verifyIdToken(m[1], true); }
  catch { const err = Error("Session expired or revoked"); err.status = 401; throw err; }
  if (!allowlisted.has(decoded.uid)) {
    const err = Error("Your Firebase UID is not allowlisted for recovery"); err.status = 403; throw err;
  }
  if (req.body?.sourceHash?.toLowerCase() !== pinnedHash) {
    const err = Error("Backup SHA-256 does not match the pinned recovery file"); err.status = 409; throw err;
  }
  return { db, uid: decoded.uid };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return reject(res, 405, "POST only");

  // Protect Vercel body limits and reject overly large/unknown payloads.
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES)
    return reject(res, 413, "Restore batch exceeds 140KB; reduce batch size");
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body))
    return reject(res, 400, "JSON object required");
  if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > MAX_REQUEST_BYTES)
    return reject(res, 413, "Restore batch exceeds 140KB");
  const action = req.body.action;
  if (!["preflight", "restore"].includes(action)) return reject(res, 400, "Unknown action");
  if (action === "restore" && req.body.confirmation !== "CREATE_MISSING_ONLY")
    return reject(res, 400, "Missing deliberate restore confirmation");

  try {
    const { db } = await authenticate(req);
    const valid = validateBatch(req.body.records, db);
    const snapshots = await db.getAll(...valid.map(x => db.doc(x.path)));
    if (action === "preflight") {
      return res.status(200).json({
        success: true, action, results: snapshots.map((snapshot, i) => ({
          path: valid[i].path, status: snapshot.exists ? "existing" : "missing"
        }))
      });
    }

    // Create-only: a race with another request returns ALREADY_EXISTS, not overwrite.
    const results = [];
    for (let i = 0; i < valid.length; i++) {
      if (snapshots[i].exists) {
        results.push({ path: valid[i].path, status: "existing" });
        continue;
      }
      try {
        await db.doc(valid[i].path).create(valid[i].data);
        results.push({ path: valid[i].path, status: "created" });
      } catch (err) {
        if (err.code === 6 || err.code === "already-exists") {
          results.push({ path: valid[i].path, status: "existing" });
        } else {
          results.push({ path: valid[i].path, status: "error", error: "Firestore create failed" });
        }
      }
    }
    return res.status(200).json({ success: true, action, results });
  } catch (err) {
    const status = err.status || (/^(Invalid|Unexpected|Unsupported|Pending|Empty|Forbidden|Batch|Duplicate|Document|Unsafe|Cross-project)/.test(err.message) ? 400 : 500);
    if (status === 500) console.error("Restore handler failed:", err?.code || "unknown");
    return reject(res, status, status === 500 ? "Restore failed. Check server logs." : err.message);
  }
}
