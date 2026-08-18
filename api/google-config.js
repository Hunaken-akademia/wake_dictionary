export default function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !publishableKey) return res.status(503).json({ error: "google_access_not_configured" });
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return res.status(400).json({ error: "invalid_host" });
  const redirectTo = `${proto}://${host}/?dictionary_oauth=1`;
  const params = new URLSearchParams({ provider: "google", redirect_to: redirectTo, apikey: publishableKey });
  const authorizeUrl = `${supabaseUrl}/auth/v1/authorize?${params}`;
  return res.status(200).json({ authorizeUrl });
}
