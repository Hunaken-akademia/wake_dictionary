import { authConfigured, makeSessionCookie, passwordMatches } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!authConfigured()) return res.status(503).json({ error: "auth_not_configured" });
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== "object") body = {};
  if (!passwordMatches(body.password)) return res.status(401).json({ error: "invalid_password" });
  res.setHeader("Set-Cookie", makeSessionCookie());
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true });
}
