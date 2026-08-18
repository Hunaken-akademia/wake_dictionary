#!/usr/bin/env node
/** WAKE辞典 v2.5 本日出走予定コレクタ */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUT_DIR = resolve(process.env.WAKE_DICTIONARY_OUT_DIR || "public/data");
const OUT_FILE = resolve(OUT_DIR, "today_entries.json");
const WOMEN_FILE = resolve(process.env.WAKE_WOMEN_RACERS_FILE || "data/women_racers.json");
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.TODAY_ENTRIES_CONCURRENCY || 10)));
const REQUIRED = String(process.env.TODAY_ENTRIES_REQUIRED || "0") === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (v) => String(Number(v)).padStart(2, "0");
const ymd = (s) => String(s).replaceAll("-", "");

function jstClock() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour)};
}
function previousDate(date) {
  const [y,m,d]=String(date).split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d)-86400000).toISOString().slice(0,10);
}
function str3Url(date, placeNo, raceNo) {
  const jcd = pad2(placeNo);
  return `https://race.boatcast.jp/hp_txt/${jcd}/bc_j_str3_${ymd(date)}_${jcd}_${pad2(raceNo)}.txt`;
}

async function fetchText(url, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${url}?wake=${Date.now()}_${attempt}`, {
        signal: controller.signal, cache: "no-store",
        headers: {
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 WAKE-Dictionary/2.5",
          accept: "text/plain,text/html,*/*", referer: "https://race.boatcast.jp/",
          "cache-control": "no-cache", pragma: "no-cache",
        },
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("EMPTY_BODY");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error("FETCH_FAILED");
}

function normalizeRaw(raw) { return String(raw || "").replace(/\r/g, "\n").replace(/\\n/g, "\n"); }
function kanaCandidate(columns) {
  const out = [];
  for (let i = 2; i < Math.min(columns.length, 12); i++) {
    const v = String(columns[i] || "").trim();
    if (!v || /^(A1|A2|B1|B2)$/.test(v)) continue;
    if (v.length >= 2 && v.length <= 24 && /^[ぁ-ゖァ-ヶー・\s]+$/.test(v)) out.push({column:i,value:v});
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
    // STR3の選手行は1〜6号艇順。WAKE連携では号艇から選手を特定し、
    // 成績の参照コース自体はWAKE側の展示進入を使う。
    const boatNo = rows.length + 1;
    rows.push({regno,racer_name:c[1]||null,boat_no:boatNo,place_no:Number(placeNo),race_no:Number(raceNo)});
    if (readingDiag.samples.length < 8) {
      const cand = kanaCandidate(c);
      if (cand.length) {
        readingDiag.rowsWithCandidate++;
        readingDiag.samples.push({regno,name:c[1]||null,candidates:cand});
      }
    }
  }
  return rows;
}

async function collectAttempt(date, fullScan = false) {
  const readingDiag = {rowsWithCandidate:0,samples:[]};
  const racerMap = new Map();
  const errorCounts = new Map();
  let successRaces = 0;
  let skippedRaces = 0;
  function addRows(rows) {
    for (const r of rows) {
      if (!racerMap.has(r.regno)) racerMap.set(r.regno,{regno:r.regno,name:r.racer_name,entries:[]});
      const target = racerMap.get(r.regno);
      const key = `${r.place_no}|${r.race_no}`;
      if (!target.entries.some((e)=>`${e.place_no}|${e.race_no}`===key)) target.entries.push({place_no:r.place_no,race_no:r.race_no,boat_no:r.boat_no});
    }
  }
  async function runJobs(jobs, fetchAttempts = 2) {
    let cursor = 0;
    async function worker() {
      while (true) {
        const job = jobs[cursor++];
        if (!job) return;
        try {
          const rows = parseStr3(await fetchText(str3Url(date,job.placeNo,job.raceNo),fetchAttempts),job.placeNo,job.raceNo,readingDiag);
          if (!rows.length) { skippedRaces++; continue; }
          successRaces++; addRows(rows);
        } catch (error) {
          skippedRaces++;
          const key = String(error?.message || error || "UNKNOWN");
          errorCounts.set(key,(errorCounts.get(key)||0)+1);
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,jobs.length||1)},()=>worker()));
  }
  if (fullScan) {
    // 全288URLを空振りさせない。各場の序盤・中盤・終盤だけを1回確認し、
    // 1件でも見つかった開催場だけ残り9Rを取得する。
    const finalProbeRaces = [1,6,12];
    await runJobs(Array.from({length:24},(_,i)=>i+1).flatMap((placeNo)=>
      finalProbeRaces.map((raceNo)=>({placeNo,raceNo}))),1);
    const active = [...new Set([...racerMap.values()].flatMap((r)=>r.entries.map((e)=>e.place_no)))];
    if (active.length) await runJobs(active.flatMap((placeNo)=>
      [2,3,4,5,7,8,9,10,11].map((raceNo)=>({placeNo,raceNo}))));
  } else {
    const probe = Array.from({length:24},(_,i)=>i+1).flatMap((placeNo)=>[
      {placeNo,raceNo:1},{placeNo,raceNo:2},
    ]);
    await runJobs(probe);
    const active = [...new Set([...racerMap.values()].flatMap((r)=>r.entries.map((e)=>e.place_no)))];
    if (active.length) await runJobs(active.flatMap((placeNo)=>
      Array.from({length:10},(_,i)=>({placeNo,raceNo:i+3}))));
  }
  return {
    racers:[...racerMap.values()],successRaces,skippedRaces,readingDiag,
    errors:Object.fromEntries([...errorCounts.entries()].sort()),
  };
}

async function womenSet() {
  try {
    const data = JSON.parse(await readFile(WOMEN_FILE,"utf8"));
    return new Set((data.racers||[]).map((r)=>Number(r.regno)).filter(Number.isInteger));
  } catch { return new Set(); }
}
function enrichRaceClass(racers,women) {
  const participants = new Map();
  for (const racer of racers) for (const e of racer.entries||[]) {
    const key = `${e.place_no}|${e.race_no}`;
    if (!participants.has(key)) participants.set(key,new Set());
    participants.get(key).add(Number(racer.regno));
  }
  const raceClass = new Map();
  for (const [key,ids] of participants) {
    raceClass.set(key,women.size && [...ids].every((id)=>women.has(id)) ? "WOMEN" : "MIXED");
  }
  for (const racer of racers) {
    racer.gender = women.has(Number(racer.regno)) ? "F" : "M";
    racer.is_female = women.has(Number(racer.regno));
    racer.entries = (racer.entries||[]).map((e)=>({...e,race_class:raceClass.get(`${e.place_no}|${e.race_no}`)||"UNKNOWN"}))
      .sort((a,b)=>a.place_no-b.place_no||a.race_no-b.race_no);
  }
  return raceClass;
}

async function main() {
  const clock = jstClock();
  const requestedDate = clock.date;
  let date = clock.hour < 8 ? previousDate(clock.date) : clock.date;
  console.log(`today_entries_calendar_date=${requestedDate}`);
  console.log(`today_entries_cutoff_hour=8 current_hour=${clock.hour}`);
  console.log(`today_entries_primary_date=${date}`);
  console.log(`concurrency=${CONCURRENCY}`);
  let result = await collectAttempt(date,false);
  console.log(`primary_probe racers=${result.racers.length} success=${result.successRaces} errors=${JSON.stringify(result.errors)}`);
  if (!result?.racers?.length) {
    console.warn("primary probe empty; running final 24-place x 3-race scan");
    result = await collectAttempt(date,true);
  }
  let usedPreviousDay = date !== requestedDate;
  if (!result?.racers?.length && date === requestedDate) {
    date = previousDate(requestedDate);
    usedPreviousDay = true;
    console.warn(`current schedule unavailable; keeping previous date=${date}`);
    result = await collectAttempt(date,false);
    if (!result?.racers?.length) result = await collectAttempt(date,true);
  }
  const women = await womenSet();
  const racers = (result.racers||[]).sort((a,b)=>a.regno-b.regno);
  const raceClass = enrichRaceClass(racers,women);
  const places = [...new Set(racers.flatMap((r)=>r.entries.map((e)=>Number(e.place_no))))].sort((a,b)=>a-b);
  const classCounts = {WOMEN:0,MIXED:0,UNKNOWN:0};
  for (const value of raceClass.values()) classCounts[value]=(classCounts[value]||0)+1;
  const payload = {
    schema_version:3,date,requested_date:requestedDate,cutoff_hour_jst:8,
    used_previous_day:usedPreviousDay,generated_at:new Date().toISOString(),source:"BOATCAST_STR3",
    status:racers.length?(usedPreviousDay?"previous_day":"ok"):"unavailable",racer_count:racers.length,
    successful_races:result.successRaces,skipped_races:result.skippedRaces,places,
    race_class_counts:classCounts,fetch_errors:result.errors,racers,
  };
  await mkdir(dirname(OUT_FILE),{recursive:true});
  await writeFile(OUT_FILE,JSON.stringify(payload),"utf8");
  console.log(`today_racer_count=${racers.length}`);
  console.log(`today_successful_races=${result.successRaces}`);
  console.log(`today_skipped_races=${result.skippedRaces}`);
  console.log(`today_places=${places.length}`);
  console.log(`today_race_classes=${JSON.stringify(classCounts)}`);
  console.log(`kana_candidate_sample_count=${result.readingDiag.samples.length}`);
  console.log(`kana_candidate_samples=${JSON.stringify(result.readingDiag.samples)}`);
  if (!racers.length) {
    const message = `schedule entries unavailable for JST ${date}`;
    if (REQUIRED) throw new Error(message);
    console.warn(`WARNING: ${message}; core dictionary deployment will continue`);
  }
}
await main();
