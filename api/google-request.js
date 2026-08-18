import { authenticatedGoogleUser, isDictionaryAdmin, PRODUCT, rest } from "../lib/google-access.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const user = await authenticatedGoogleUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  const body = req.body || {};
  const buyerName = String(body.buyerName || "").trim();
  const proofObjectPath = String(body.proofObjectPath || "").trim();
  const purchasedAt = new Date(String(body.purchasedAt || ""));
  if (!buyerName || buyerName.length > 80) return res.status(400).json({ error: "invalid_buyer_name" });
  if (!Number.isFinite(purchasedAt.getTime()) || purchasedAt.getTime() > Date.now() + 300000) return res.status(400).json({ error: "invalid_purchased_at" });
  if (!proofObjectPath.startsWith(`${user.id}/`) || proofObjectPath.includes("..") || proofObjectPath.includes("\\")) {
    return res.status(400).json({ error: "invalid_proof_path" });
  }
  try {
    await rest("dictionary_access_requests?on_conflict=product,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        product: PRODUCT, user_id: user.id, google_email: user.email,
        buyer_name: buyerName, purchased_at: purchasedAt.toISOString(),
        proof_object_path: proofObjectPath, status: "pending",
        approved_at: null, approved_by: null, rejected_at: null,
        rejected_by: null, admin_note: null, updated_at: new Date().toISOString()
      }),
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: error.message || "request_failed" });
  }
}
