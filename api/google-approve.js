import { authenticatedGoogleUser, isDictionaryAdmin, PRODUCT, rest } from "../lib/google-access.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const admin = await authenticatedGoogleUser(req);
  if (!admin) return res.status(401).json({ error: "unauthorized" });
  if (!isDictionaryAdmin(admin)) return res.status(403).json({ error: "admin_only" });
  try {
    const query = new URLSearchParams({ select: "id,user_id,google_email,status", product: `eq.${PRODUCT}`, user_id: `eq.${admin.id}`, limit: "1" });
    const rows = await rest(`dictionary_access_requests?${query}`);
    const request = Array.isArray(rows) ? rows[0] : null;
    if (!request || request.status !== "pending") return res.status(409).json({ error: "pending_request_not_found" });
    const now = new Date().toISOString();
    await rest("dictionary_entitlements?on_conflict=product,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ product: PRODUCT, user_id: request.user_id, google_email: request.google_email, status: "active", starts_at: now, expires_at: "2027-12-31T14:59:59.999Z", source: "admin_self_beta", updated_at: now }),
    });
    await rest(`dictionary_access_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "approved", approved_at: now, approved_by: admin.email, updated_at: now }),
    });
    return res.status(200).json({ ok: true, expiresAt: "2027-12-31T14:59:59.999Z" });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: error.message || "approval_failed" });
  }
}
