import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "wake_access";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  return String(process.env.WAKE_DICTIONARY_SESSION_SECRET || "");
}
function configuredPassword() {
  return String(process.env.WAKE_DICTIONARY_PASSWORD || "");
}
function sign(value) {
  const s = secret();
  if (!s) return "";
  return createHmac("sha256", s).update(value).digest("base64url");
}
function equal(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}
export function authConfigured() {
  return Boolean(configuredPassword() && secret());
}
export function passwordMatches(input) {
  if (!authConfigured()) return false;
  return equal(String(input || ""), configuredPassword());
}
export function makeSessionCookie() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const value = `${exp}.${sign(String(exp))}`;
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export function isAuthorized(req) {
  if (!authConfigured()) return false;
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (!token) return false;
  const [expText, signature] = token.split(".");
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now()/1000)) return false;
  return equal(signature || "", sign(expText));
}
