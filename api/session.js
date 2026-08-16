import { isAuthorized } from "../lib/auth.js";
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthorized(req)) return res.status(401).json({ ok: false });
  return res.status(200).json({ ok: true });
}
