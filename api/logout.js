import { clearSessionCookie } from "../lib/auth.js";
export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true });
}
