import { authenticatedGoogleUser, isDictionaryAdmin, PRODUCT, rest } from "../lib/google-access.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const user = await authenticatedGoogleUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!isDictionaryAdmin(user)) return res.status(403).json({ error: "beta_admin_only" });
  try {
    await rest("dictionary_access_requests?on_conflict=product,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ product: PRODUCT, user_id: user.id, google_email: user.email, status: "pending", updated_at: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: error.message || "request_failed" });
  }
}
