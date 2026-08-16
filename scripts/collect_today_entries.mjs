#!/usr/bin/env node
/**
 * WAKE辞典 v1.8 本日出走予定コレクタ
 *
 * 公式BOATCAST str3の当日出走表を読み、
 * public/data/today_entries.json を生成する。
 *
 * - 24場 × 1〜12Rを確認
 * - 404/403等はそのレースだけスキップ
 * - 0件でもサイト全体のデプロイは止めない
 * - 読み仮名候補がstr3内に存在するか診断ログも出す
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUT_DIR = resolve(process.env.WAKE_DICTIONARY_OUT_DIR || "public/data");
const OUT_FILE = resolve(OUT_DIR, "today_entries.json");
const CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.TODAY_ENTRIES_CONCURRENCY || 10))
);

function jstDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

function ymd(s) { return String(s).replaceAll("-", ""); }
function pad2(v) { return String(Number(v)).padStart(2, "0"); }

function str3Url(date, placeNo, raceNo) {
  const jcd = pad2(placeNo);
  const rr = pad2(raceNo);
  return `https://race.boatcast.jp/hp_txt/${jcd}/bc_j_str3_${ymd(date)}_${jcd}_${rr}.txt`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 WAKE-Dictionary/1.7",
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

function normalizeRaw(raw) {
  return String(raw || "")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n");
}

function kanaCandidate(columns) {
  // 位置は決め打ちしない。既知のname/branch/grade以外から
  // ひらがな/カタカナ主体の値だけを「診断候補」として拾う。
  const out = [];
  for (let i = 2; i < Math.min(columns.length, 12); i++) {
    const v = String(columns[i] || "").trim();
    if (!v || /^(A1|A2|B1|B2)$/.test(v)) continue;
    if (v.length < 2 || v.length > 24) continue;
    if (/^[ぁ-ゖァ-ヶー・\s]+$/.test(v)) out.push({ column: i, value: v });
  }
  return out;
}

function parseStr3(raw, placeNo, raceNo, readingDiag) {
  const rows = [];
  for (const line of normalizeRaw(raw).split(/\n+/)) {
    if (!/^\d{4}\t/.test(line)) continue;
    const c = line.split("\t").map((x) => String(x || "").trim());
    if (c.length < 6) continue;

    const regno = Number(c[0]);
    if (!Number.isFinite(regno) || regno <= 0) continue;

    rows.push({
      regno,
      racer_name: c[1] || null,
      place_no: Number(placeNo),
      race_no: Number(raceNo),
    });

    if (readingDiag.samples.length < 8) {
      const cand = kanaCandidate(c);
      if (cand.length) {
        readingDiag.rowsWithCandidate++;
        readingDiag.samples.push({
          regno,
          name: c[1] || null,
          candidates: cand,
        });
      }
    }
  }
  return rows;
}

async function main() {
  const date = jstDate();
  console.log(`today_entries_date=${date}`);
  console.log(`concurrency=${CONCURRENCY}`);

  const readingDiag = { rowsWithCandidate: 0, samples: [] };
  const racerMap = new Map();
  let successRaces = 0;
  let skippedRaces = 0;

  function addRows(rows) {
    for (const r of rows) {
      if (!racerMap.has(r.regno)) {
        racerMap.set(r.regno, { regno: r.regno, name: r.racer_name, entries: [] });
      }
      const target = racerMap.get(r.regno);
      const key = `${r.place_no}|${r.race_no}`;
      if (!target.entries.some((e) => `${e.place_no}|${e.race_no}` === key)) {
        target.entries.push({ place_no: r.place_no, race_no: r.race_no });
      }
    }
  }

  async function runJobs(jobs) {
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= jobs.length) return;
        const job = jobs[i];
        try {
          const raw = await fetchText(str3Url(date, job.placeNo, job.raceNo));
          const rows = parseStr3(raw, job.placeNo, job.raceNo, readingDiag);
          if (!rows.length) { skippedRaces++; continue; }
          successRaces++;
          addRows(rows);
        } catch {
          skippedRaces++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length || 1) }, () => worker()));
  }

  // まず24場の1Rだけ確認。1Rが存在する場だけを開催場とみなし、
  // 2〜12Rを取得する。全24場×12R=288リクエストを毎朝叩かない。
  const probeJobs = Array.from({ length: 24 }, (_, i) => ({ placeNo: i + 1, raceNo: 1 }));
  await runJobs(probeJobs);

  const activePlaces = [...new Set(
    [...racerMap.values()].flatMap((r) => r.entries.map((e) => e.place_no))
  )].sort((a,b) => a-b);

  const remainingJobs = activePlaces.flatMap((placeNo) =>
    Array.from({ length: 11 }, (_, i) => ({ placeNo, raceNo: i + 2 }))
  );
  console.log(`active_places=${activePlaces.length}`);
  console.log(`jobs_total=${probeJobs.length + remainingJobs.length}`);
  await runJobs(remainingJobs);

  const racers = [...racerMap.values()]
    .map((r) => ({
      ...r,
      entries: r.entries.sort(
        (a,b) => a.place_no - b.place_no || a.race_no - b.race_no
      ),
    }))
    .sort((a,b) => a.regno - b.regno);

  const places = [...new Set(
    racers.flatMap((r) => r.entries.map((e) => Number(e.place_no)))
  )].sort((a,b) => a-b);

  const payload = {
    schema_version: 1,
    date,
    generated_at: new Date().toISOString(),
    source: "BOATCAST_STR3",
    status: racers.length ? "ok" : "unavailable",
    racer_count: racers.length,
    successful_races: successRaces,
    skipped_races: skippedRaces,
    places,
    racers,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload), "utf8");

  console.log(`today_racer_count=${racers.length}`);
  console.log(`today_successful_races=${successRaces}`);
  console.log(`today_skipped_races=${skippedRaces}`);
  console.log(`today_places=${places.length}`);

  // かな検索実装前の診断。
  // ここに一貫した読み仮名列が見つかれば、次版で全1649人分を正式取得する。
  console.log(`kana_candidate_sample_count=${readingDiag.samples.length}`);
  if (readingDiag.samples.length) {
    console.log(`kana_candidate_samples=${JSON.stringify(readingDiag.samples)}`);
  } else {
    console.log("kana_candidate_samples=[]");
  }

  if (!racers.length) {
    console.warn("WARNING: today entries were not available; site will deploy without today filter data.");
  }
}

await main();
