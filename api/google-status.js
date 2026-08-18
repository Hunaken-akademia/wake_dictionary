import { activeEntitlement, authenticatedGoogleUser, isDictionaryAdmin, rest } from "../lib/google-access.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const user = await authenticatedGoogleUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  try {
    const query = new URLSearchParams({ select: "id,status,buyer_name,purchased_at,created_at,updated_at,admin_note", user_id: `eq.${user.id}`, limit: "1" });
    const [requests, entitlement] = await Promise.all([rest(`dictionary_access_requests?${query}`), activeEntitlement(user)]);
    return res.status(200).json({
      user: { email: user.email },
      isAdmin: isDictionaryAdmin(user),
      request: Array.isArray(requests) ? requests[0] || null : null,
      entitlement,
    });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: error.message || "status_failed" });
  }
}
