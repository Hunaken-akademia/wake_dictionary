#!/usr/bin/env node

const RAW = String(process.env.SUPABASE_URL || "").trim();
const BASE = RAW.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
const KEY = String(process.env.SUPABASE_SERVICE_KEY || "");

if (!BASE || !KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are required");
}

const url = `${BASE}/rest/v1/wake_dictionary_metadata_v1?select=generated_on,raw_races,usable_races&limit=1`;

const res = await fetch(url, {
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
  },
});
const body = await res.text();

console.log(`normalized_base=${BASE}`);
console.log(`status=${res.status}`);
console.log(body);

if (!res.ok) process.exit(1);
