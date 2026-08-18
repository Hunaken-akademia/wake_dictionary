import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isAuthorized } from "../lib/auth.js";
import { isGoogleDictionaryAuthorized } from "../lib/google-access.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "private-data");
function safePath(value) {
  const raw = String(value || "");
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded || decoded.length > 220 || !decoded.endsWith(".json")) return null;
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const full = resolve(ROOT, decoded);
  if (!(full === ROOT || full.startsWith(ROOT + sep))) return null;
  return full;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const allowed = isAuthorized(req) || await isGoogleDictionaryAuthorized(req);
  if (!allowed) return res.status(401).json({ error: "unauthorized" });
  const file = safePath(req.query?.path);
  if (!file) return res.status(400).json({ error: "invalid_path" });
  try {
    const text = await readFile(file, "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(text);
  } catch (e) {
    if (e?.code === "ENOENT") return res.status(404).json({ error: "not_found" });
    console.error(e);
    return res.status(500).json({ error: "read_failed" });
  }
}
