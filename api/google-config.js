export default function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !publishableKey) return res.status(503).json({ error: "google_access_not_configured" });
  // Always return OAuth to the stable production domain. Preview deployment
  // URLs are ephemeral and can become DEPLOYMENT_NOT_FOUND after a redeploy.
  const publicUrl = String(
    process.env.WAKE_DICTIONARY_PUBLIC_URL || "https://wake-dictionary.vercel.app"
  ).trim().replace(/\/+$/, "");
  const redirectTo = `${publicUrl}/?dictionary_oauth=1`;
  const params = new URLSearchParams({ provider: "google", redirect_to: redirectTo, apikey: publishableKey });
  const authorizeUrl = `${supabaseUrl}/auth/v1/authorize?${params}`;
  return res.status(200).json({ authorizeUrl });
}
