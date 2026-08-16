#!/usr/bin/env node
/**
 * WAKE辞典 v1.3 racer profile collector
 *
 * Source:
 *   BOATCAST str3 racer-entry feed already used by WAKE.
 *
 * Does not touch WAKE ingest tables.
 */

const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_URL = RAW_SUPABASE_URL
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || "");

const FRESH_DAYS = Math.max(1, Number(process.env.RACER_PROFILE_FRESH_DAYS || 7));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.RACER_PROFILE_CONCURRENCY || 4)));
const PAGE_SIZE = 1000;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are required");
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function fetchAll(resource, { select="*", order="", filters=[] }={}) {
  const out = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const q = new URLSearchParams({
      select,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (order) q.set("order", order);
    for (const [k,v] of filters) q.append(k,v);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${q}`, { headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`${resource} ${res.status}: ${text.slice(0,1000)}`);
    const rows = text ? JSON.parse(text) : [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function upsertProfiles(rows) {
  if (!rows.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/wake_dictionary_racer_profile_v1?on_conflict=regno`,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`profile upsert ${res.status}: ${text.slice(0,1000)}`);
}

function pad2(v) { return String(Number(v)).padStart(2, "0"); }
function ymd(v) { return String(v || "").replaceAll("-", ""); }
function raceKey(r) { return `${r.race_date}|${Number(r.place_no)}|${Number(r.race_no)}`; }
function str3Url(r) {
  const jcd = pad2(r.place_no);
  const rr = pad2(r.race_no);
  const d = ymd(r.race_date);
  return `https://race.boatcast.jp/hp_txt/${jcd}/bc_j_str3_${d}_${jcd}_${rr}.txt`;
}

function parseStr3(raw, seed) {
  const normalized = String(raw || "")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n");

  const out = [];
  for (const line of normalized.split(/\n+/)) {
    if (!/^\d{4}\t/.test(line)) continue;
    const c = line.split("\t").map((x) => String(x || "").trim());
    if (c.length < 20) continue;

    const regno = Number(c[0]);
    if (!Number.isFinite(regno) || regno <= 0) continue;

    const grade = /^(A1|A2|B1|B2)$/.test(c[5]) ? c[5] : null;
    const branch = String(c[3] || "").split(":")[0].trim() || null;
    if (!grade) continue;

    out.push({
      regno,
      racer_name: c[1] || null,
      grade,
      branch,
      source: "BOATCAST_STR3",
      source_race_date: seed.race_date,
      source_place_no: Number(seed.place_no),
      source_race_no: Number(seed.race_no),
      captured_at: new Date().toISOString(),
    });
  }
  return out;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 WAKE-Dictionary/1.3",
        accept: "text/plain,text/html,*/*",
        referer: "https://race.boatcast.jp/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function freshEnough(row) {
  if (!row?.captured_at) return false;
  const age = Date.now() - new Date(row.captured_at).getTime();
  return age >= 0 && age < FRESH_DAYS * 86400_000;
}

async function main() {
  const [seeds, existing] = await Promise.all([
    fetchAll("wake_dictionary_racer_profile_seed_v1", {
      select: "regno,race_date,place_no,race_no",
      order: "race_date.desc,place_no.asc,race_no.asc",
    }),
    fetchAll("wake_dictionary_racer_profile_v1", {
      select: "regno,grade,branch,captured_at",
    }),
  ]);

  const profileByRegno = new Map(existing.map((r) => [Number(r.regno), r]));
  const groups = new Map();

  for (const seed of seeds) {
    const k = raceKey(seed);
    if (!groups.has(k)) groups.set(k, { seed, targetRegnos: new Set() });
    groups.get(k).targetRegnos.add(Number(seed.regno));
  }

  const jobs = [];
  for (const g of groups.values()) {
    const allFresh = [...g.targetRegnos].every((regno) => freshEnough(profileByRegno.get(regno)));
    if (!allFresh) jobs.push(g);
  }

  console.log(`seed_racers=${seeds.length}`);
  console.log(`unique_seed_races=${groups.size}`);
  console.log(`existing_profiles=${existing.length}`);
  console.log(`races_to_fetch=${jobs.length}`);
  console.log(`fresh_days=${FRESH_DAYS}`);
  console.log(`concurrency=${CONCURRENCY}`);

  let cursor = 0;
  let fetched = 0;
  let failed = 0;
  let parsedRows = 0;
  const collected = new Map();

  async function worker(workerNo) {
    while (true) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const g = jobs[i];
      const url = str3Url(g.seed);
      try {
        const raw = await fetchText(url);
        const rows = parseStr3(raw, g.seed);
        for (const row of rows) collected.set(row.regno, row);
        parsedRows += rows.length;
        fetched++;
        if ((fetched + failed) % 25 === 0 || i === jobs.length - 1) {
          console.log(`profile fetch ${fetched + failed}/${jobs.length} ok=${fetched} failed=${failed} unique_profiles=${collected.size}`);
        }
      } catch (e) {
        failed++;
        console.warn(`profile fetch skipped worker=${workerNo} ${g.seed.race_date} place=${g.seed.place_no} race=${g.seed.race_no}: ${e.message || e}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  const rows = [...collected.values()];
  for (let i = 0; i < rows.length; i += 250) {
    await upsertProfiles(rows.slice(i, i + 250));
  }

  const finalProfiles = await fetchAll("wake_dictionary_racer_profile_v1", {
    select: "regno,grade,branch",
  });

  const validGrade = finalProfiles.filter((r) => /^(A1|A2|B1|B2)$/.test(String(r.grade || ""))).length;
  const validBranch = finalProfiles.filter((r) => String(r.branch || "").trim()).length;

  console.log(`parsed_rows=${parsedRows}`);
  console.log(`upsert_unique_profiles=${rows.length}`);
  console.log(`profile_total=${finalProfiles.length}`);
  console.log(`grade_total=${validGrade}`);
  console.log(`branch_total=${validBranch}`);
  for (const grade of ["A1","A2","B1","B2"]) {
    const n = finalProfiles.filter((r) => r.grade === grade).length;
    console.log(`grade_${grade}=${n}`);
  }

  if (validGrade === 0) throw new Error("No valid racer grades were collected");
}

await main();
