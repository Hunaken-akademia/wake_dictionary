import { authenticatedGoogleUser, isDictionaryAdmin, PRODUCT, rest } from "../lib/google-access.js";

const BUCKET = "dictionary-purchase-proofs";
const EXPIRES_AT = "2027-12-31T14:59:59.999Z";
const MAX_BATCH = 50;

function encodedPath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

async function applicationById(id) {
  const rows = await rest(`dictionary_access_requests?id=eq.${encodeURIComponent(id)}&product=eq.${PRODUCT}&select=*`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function approveApplication(application, admin, now) {
  if (application.status === "approved") return "already_approved";
  if (application.status !== "proof_checked") return "proof_not_checked";
  await rest("dictionary_entitlements?on_conflict=product,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      product: PRODUCT,
      user_id: application.user_id,
      google_email: application.google_email,
      status: "active",
      starts_at: now,
      expires_at: EXPIRES_AT,
      source: "purchase_proof",
      updated_at: now,
    }),
  });
  await rest(`dictionary_access_requests?id=eq.${encodeURIComponent(application.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "approved",
      approved_at: now,
      approved_by: admin.email,
      rejected_at: null,
      rejected_by: null,
      admin_note: null,
      updated_at: now,
    }),
  });
  return "approved";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const admin = await authenticatedGoogleUser(req);
  if (!admin) return res.status(401).json({ error: "unauthorized" });
  if (!isDictionaryAdmin(admin)) return res.status(403).json({ error: "admin_only" });

  try {
    if (req.method === "GET") {
      const query = new URLSearchParams({
        select: "id,user_id,google_email,buyer_name,purchased_at,proof_object_path,status,created_at,updated_at,proof_checked_at,proof_checked_by,approved_at,approved_by,rejected_at,rejected_by,admin_note",
        product: `eq.${PRODUCT}`,
        order: "created_at.desc",
        limit: "500",
      });
      return res.status(200).json({
        ok: true,
        adminEmail: admin.email,
        applications: await rest(`dictionary_access_requests?${query}`),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    const action = String(req.body?.action || "");
    const now = new Date().toISOString();

    if (action === "approve_batch") {
      const ids = [...new Set((req.body?.ids || []).map(String).filter(Boolean))].slice(0, MAX_BATCH);
      if (!ids.length) return res.status(400).json({ error: "no_applications_selected" });
      const summary = { approved: 0, alreadyApproved: 0, proofNotChecked: 0 };
      for (const id of ids) {
        const application = await applicationById(id);
        if (!application) continue;
        const result = await approveApplication(application, admin, now);
        if (result === "approved") summary.approved++;
        if (result === "already_approved") summary.alreadyApproved++;
        if (result === "proof_not_checked") summary.proofNotChecked++;
      }
      return res.status(200).json({ ok: true, summary });
    }

    const id = String(req.body?.id || "");
    const application = await applicationById(id);
    if (!application) return res.status(404).json({ error: "application_not_found" });

    if (action === "proof") {
      const signed = await fetch(`${String(process.env.SUPABASE_URL).replace(/\/+$/, "").replace(/\/rest\/v1$/i, "")}/storage/v1/object/sign/${BUCKET}/${encodedPath(application.proof_object_path)}`, {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 300 }),
      });
      if (!signed.ok) throw new Error("proof_sign_failed");
      const data = await signed.json();
      const base = String(process.env.SUPABASE_URL).replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
      return res.status(200).json({
        ok: true,
        url: data.signedURL?.startsWith("http") ? data.signedURL : `${base}/storage/v1${data.signedURL}`,
        isPdf: String(application.proof_object_path || "").toLowerCase().endsWith(".pdf"),
      });
    }

    if (action === "check" || action === "uncheck") {
      const checked = action === "check";
      await rest(`dictionary_access_requests?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: checked ? "proof_checked" : "pending",
          proof_checked_at: checked ? now : null,
          proof_checked_by: checked ? admin.email : null,
          approved_at: null,
          approved_by: null,
          rejected_at: null,
          rejected_by: null,
          admin_note: null,
          updated_at: now,
        }),
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "approve") {
      const result = await approveApplication(application, admin, now);
      if (result === "proof_not_checked") return res.status(409).json({ error: "proof_not_checked" });
      return res.status(200).json({ ok: true, result });
    }

    if (action === "reject") {
      const note = String(req.body?.note || "購入証明を確認できませんでした。").slice(0, 300);
      if (application.status === "approved") {
        await rest(`dictionary_entitlements?product=eq.${PRODUCT}&user_id=eq.${encodeURIComponent(application.user_id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "revoked", updated_at: now }),
        });
      }
      await rest(`dictionary_access_requests?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "rejected",
          rejected_at: now,
          rejected_by: admin.email,
          admin_note: note,
          proof_checked_at: null,
          proof_checked_by: null,
          approved_at: null,
          approved_by: null,
          updated_at: now,
        }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "invalid_action" });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: error.message || "admin_failed" });
  }
}
