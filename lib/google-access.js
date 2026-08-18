const PRODUCT = "wake_dictionary";

function env(name) {
  return String(process.env[name] || "").trim();
}

function supabaseHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_KEY");
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export function googleAccessConfigured() {
  return Boolean(env("SUPABASE_URL") && env("SUPABASE_SERVICE_KEY"));
}

export function adminEmails() {
  return new Set(env("WAKE_DICTIONARY_ADMIN_EMAILS").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
}

export async function authenticatedGoogleUser(req) {
  if (!googleAccessConfigured()) return null;
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_SERVICE_KEY"), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json();
  const email = String(user?.email || "").trim().toLowerCase();
  return user?.id && email ? { id: user.id, email } : null;
}

export async function rest(path, options = {}) {
  if (!googleAccessConfigured()) throw new Error("google_access_not_configured");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    ...options,
    headers: supabaseHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Supabase REST error", response.status, detail.slice(0, 500));
    throw new Error("database_request_failed");
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function activeEntitlement(user) {
  const query = new URLSearchParams({
    select: "id,starts_at,expires_at,status",
    product: `eq.${PRODUCT}`,
    user_id: `eq.${user.id}`,
    status: "eq.active",
    starts_at: `lte.${new Date().toISOString()}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });
  const rows = await rest(`dictionary_entitlements?${query}`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function isGoogleDictionaryAuthorized(req) {
  try {
    const user = await authenticatedGoogleUser(req);
    return Boolean(user && await activeEntitlement(user));
  } catch (error) {
    console.error(error);
    return false;
  }
}

export function isDictionaryAdmin(user) {
  return Boolean(user?.email && adminEmails().has(user.email));
}

export { PRODUCT };
