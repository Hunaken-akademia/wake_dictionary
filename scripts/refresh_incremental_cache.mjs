#!/usr/bin/env node
/**
 * WAKE辞典 v2.3 incremental cache refresher
 *
 * First run: seeds all current racers once.
 * Later runs: refreshes only racers affected by
 *   - newly added result dates since previous successful cache state
 *   - rows falling out of the rolling 24m window
 *   - rows falling out of the rolling 1y defense window
 *   - new racers missing from the cache
 *
 * Optional:
 *   WAKE_FORCE_FULL_REFRESH=1  -> refresh every current racer manually
 */

const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || "");
const FORCE_FULL = String(process.env.WAKE_FORCE_FULL_REFRESH || "") === "1";
const PAGE_SIZE = 1000;
const COURSE_BATCH = Math.max(5, Number(process.env.WAKE_RACER_BATCH_SIZE || 50));
const VENUE_BATCH = Math.max(5, Number(process.env.WAKE_VENUE_BATCH_SIZE || 50));
const KIM_BATCH = Math.max(2, Number(process.env.WAKE_KIMARITE_BATCH_SIZE || 10));
const DEF_BATCH = Math.max(2, Number(process.env.WAKE_DEFENSE_BATCH_SIZE || 20));
const VENUE_COURSE_BATCH = Math.max(5, Number(process.env.WAKE_VENUE_COURSE_BATCH_SIZE || 25));
// rank / kimarite / STなど既存行の後日訂正はcreated_atが変わらない場合がある。
// そのため直近数日分だけは毎回再計算し、差分キャッシュの取りこぼしを自動修復する。
const RECENT_CORRECTION_RECHECK_DAYS = Math.max(
  1,
  Number(process.env.WAKE_RECENT_CORRECTION_RECHECK_DAYS || 3)
);

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are required");
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function isTimeout(e) {
  const s = String(e?.message || e || "");
  return s.includes('"code":"57014"') || s.includes("statement timeout");
}
function chunk(a, size) {
  const out=[]; for (let i=0;i<a.length;i+=size) out.push(a.slice(i,i+size)); return out;
}
function groupBy(rows, key) {
  const m=new Map();
  for (const r of rows) {
    const k=String(r[key]);
    if(!m.has(k)) m.set(k,[]);
    m.get(k).push(r);
  }
  return m;
}
function isoDay(d) { return d.toISOString().slice(0,10); }
function addDays(s, days) {
  const d=new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return isoDay(d);
}
function defenseStartFromEnd(end) {
  const d=new Date(`${end}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear()-1);
  d.setUTCDate(d.getUTCDate()+1);
  return isoDay(d);
}

async function fetchAll(resource, {select="*", order="", filters=[]}={}) {
  const out=[];
  for(let offset=0;;offset+=PAGE_SIZE){
    const qs=new URLSearchParams();
    qs.set("select",select); qs.set("limit",String(PAGE_SIZE)); qs.set("offset",String(offset));
    if(order) qs.set("order",order);
    for(const [k,v] of filters) qs.append(k,v);
    const res=await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${qs}`,{headers});
    const text=await res.text();
    if(!res.ok) throw new Error(`${resource} ${res.status}: ${text.slice(0,1000)}`);
    const rows=text?JSON.parse(text):[];
    if(!Array.isArray(rows)) throw new Error(`${resource}: expected array`);
    out.push(...rows);
    if(rows.length<PAGE_SIZE) break;
  }
  return out;
}

async function fetchRetry(resource, options={}, attempts=4) {
  let last;
  for(let a=1;a<=attempts;a++){
    try { return await fetchAll(resource,options); }
    catch(e){
      last=e;
      if(!isTimeout(e) || a===attempts) throw e;
      const ms=1500*a;
      console.warn(`${resource}: timeout attempt ${a}/${attempts}; retry ${ms}ms`);
      await sleep(ms);
    }
  }
  throw last;
}

async function fetchChunkAdaptive(resource, ids, {select="*",order="regno.asc"}={}) {
  if(!ids.length) return [];
  try {
    return await fetchAll(resource,{select,order,filters:[["regno",`in.(${ids.join(",")})`]]});
  } catch(e) {
    if(!isTimeout(e) || ids.length<=1) throw e;
    const mid=Math.ceil(ids.length/2);
    const left=ids.slice(0,mid), right=ids.slice(mid);
    console.warn(`${resource}: timeout for ${ids.length}; split -> ${left.length}+${right.length}`);
    const a=await fetchChunkAdaptive(resource,left,{select,order});
    const b=await fetchChunkAdaptive(resource,right,{select,order});
    return [...a,...b];
  }
}

async function fetchBatched(resource, regnos, {select="*",order="regno.asc",batchSize=50}={}) {
  const batches=chunk(regnos,batchSize), all=[];
  for(let i=0;i<batches.length;i++){
    const rows=await fetchChunkAdaptive(resource,batches[i],{select,order});
    all.push(...rows);
    console.log(`${resource}: batch ${i+1}/${batches.length} racers=${batches[i].length} rows=${rows.length}`);
  }
  return all;
}


async function rpc(functionName, payload = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {...headers, "Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${functionName} ${res.status}: ${text.slice(0,1000)}`);
  const rows = text ? JSON.parse(text) : [];
  if (!Array.isArray(rows)) throw new Error(`${functionName}: expected array`);
  return rows;
}

async function fetchVenueCourseChunkAdaptive(ids) {
  if (!ids.length) return [];
  try {
    return await rpc("wake_dictionary_venue_course_stats_for_racers_v1", {
      p_regnos: ids,
    });
  } catch (e) {
    if (!isTimeout(e) || ids.length <= 1) throw e;
    const mid = Math.ceil(ids.length / 2);
    const left = ids.slice(0, mid);
    const right = ids.slice(mid);
    console.warn(
      `venue_course_rpc: timeout for ${ids.length}; split -> ${left.length}+${right.length}`
    );
    const a = await fetchVenueCourseChunkAdaptive(left);
    const b = await fetchVenueCourseChunkAdaptive(right);
    return [...a, ...b];
  }
}

async function upsert(resource, rows, onConflict) {
  if(!rows.length) return;
  for(const batch of chunk(rows,50)){
    const qs=new URLSearchParams();
    if(onConflict) qs.set("on_conflict",onConflict);
    const res=await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${qs}`,{
      method:"POST",
      headers:{...headers,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify(batch),
    });
    const text=await res.text();
    if(!res.ok) throw new Error(`${resource} upsert ${res.status}: ${text.slice(0,1000)}`);
  }
}

async function impactRows(startInclusive, endExclusive) {
  if(!startInclusive || !endExclusive || startInclusive>=endExclusive) return [];
  return fetchAll("race_results",{
    select:"regno",
    filters:[["race_date",`gte.${startInclusive}`],["race_date",`lt.${endExclusive}`]],
  });
}

async function lateCreatedRows(sinceIso, periodStart, periodEnd) {
  if(!sinceIso) return [];
  return fetchAll("race_results",{
    select:"regno",
    filters:[
      ["created_at",`gt.${sinceIso}`],
      ["race_date",`gte.${periodStart}`],
      ["race_date",`lte.${periodEnd}`],
    ],
  });
}

console.log("WAKE dictionary v2.3.2 incremental cache refresh start");
console.log(`force_full=${FORCE_FULL}`);

// Supabaseの重いmetadata VIEWと他queryを同時に走らせない。
// VIEWを直接叩くとPostgREST接続既定のstatement_timeout(8s)に対し実運用データ量
// (24ヶ月・36万行超)では不安定に超過するため、この集計だけstatement_timeoutを
// 緩和したRPC関数(wake_dictionary_metadata_v1_fn, STABLEなのでGETで呼べる)経由にする。
const metadataRows = await fetchRetry("rpc/wake_dictionary_metadata_v1_fn");
const racers = await fetchRetry("wake_dictionary_racers_v1",{order:"regno.asc"});
const cacheMeta = await fetchRetry("wake_dictionary_incremental_cache_v1",{
  select:"regno,data_end,period_start_24m,defense_start_1y",
  order:"regno.asc"
});
let venueCourseCacheMeta;
try {
  venueCourseCacheMeta = await fetchRetry("wake_dictionary_venue_course_cache_v1",{
    select:"regno,data_end,period_start_24m",
    order:"regno.asc"
  });
} catch (e) {
  if (String(e?.message || e).includes("PGRST205") || String(e?.message || e).includes("404")) {
    throw new Error("wake_dictionary_venue_course_cache_v1 is not ready. Run sql/11_venue_course_cache.sql first.");
  }
  throw e;
}
const stateRows = await fetchRetry("wake_dictionary_incremental_state_v1",{
  filters:[["id","eq.1"]]
});

if(metadataRows.length!==1) throw new Error(`metadata rows=${metadataRows.length}`);
const md=metadataRows[0];
const currentEnd=String(md.actual_end);
const currentStart=String(md.requested_start);
const currentDefenseStart=defenseStartFromEnd(currentEnd);
const currentRawRows=Number(md.raw_rows || 0);
const state=stateRows[0] || null;
const currentRegnos=racers.map(r=>Number(r.regno)).filter(Number.isFinite);
const currentSet=new Set(currentRegnos);
const cachedSet=new Set(cacheMeta.map(r=>Number(r.regno)).filter(Number.isFinite));
const venueCourseCachedSet=new Set(
  venueCourseCacheMeta.map(r=>Number(r.regno)).filter(Number.isFinite)
);
const affected=new Set();
let mode="DELTA";

for(const r of currentRegnos) {
  if(!cachedSet.has(r) || !venueCourseCachedSet.has(r)) affected.add(r);
}

if(FORCE_FULL || !state?.last_data_end || !state?.period_start_24m || !state?.defense_start_1y){
  mode=FORCE_FULL?"FORCED_FULL":"FULL_SEED";
  for(const r of currentRegnos) affected.add(r);
} else {
  const oldEnd=String(state.last_data_end);
  const oldStart=String(state.period_start_24m);
  const oldDefenseStart=String(state.defense_start_1y);

  const newStart=addDays(oldEnd,1);
  const newEndExclusive=addDays(currentEnd,1);
  const newRows = newStart < newEndExclusive ? await impactRows(newStart,newEndExclusive) : [];
  const expired24 = oldStart < currentStart ? await impactRows(oldStart,currentStart) : [];
  const expiredDefense = oldDefenseStart < currentDefenseStart ? await impactRows(oldDefenseStart,currentDefenseStart) : [];
  const lateRows = await lateCreatedRows(state.updated_at, currentStart, currentEnd);

  // created_atだけでは拾えない「既存結果行の後日訂正」対策。
  // 例: rankが1→2へ訂正された場合、総走数nは同じでもwin_n/ren2_n等だけ変わる。
  // 直近N日を毎朝recheckして、その期間に走った選手だけ再集計する。
  const correctionRecheckStart = addDays(
    currentEnd,
    -(RECENT_CORRECTION_RECHECK_DAYS - 1)
  );
  const correctionRecheckEndExclusive = addDays(currentEnd, 1);
  const recentCorrectionRows = await impactRows(
    correctionRecheckStart,
    correctionRecheckEndExclusive
  );

  for(const x of [
    ...newRows,
    ...expired24,
    ...expiredDefense,
    ...lateRows,
    ...recentCorrectionRows,
  ]){
    const r=Number(x.regno);
    if(Number.isFinite(r) && currentSet.has(r)) affected.add(r);
  }

  // raw_rows差分は診断用。除外レース等で単純一致しない可能性があるため、
  // ここだけを理由に全1649人refreshへ戻さない。
  const oldRaw=Number(state.raw_rows || 0);
  const expectedDelta=newRows.length-expired24.length;
  const actualDelta=currentRawRows-oldRaw;
  if(Number.isFinite(oldRaw) && actualDelta!==expectedDelta){
    console.warn(`raw_rows delta differs actual=${actualDelta} boundary_expected=${expectedDelta}; continuing DELTA. Use force_full_refresh only after known historical corrections.`);
  }

  console.log(`delta_new_rows=${newRows.length}`);
  console.log(`delta_expired_24m_rows=${expired24.length}`);
  console.log(`delta_expired_defense_rows=${expiredDefense.length}`);
  console.log(`delta_late_created_rows=${lateRows.length}`);
  console.log(
    `delta_recent_correction_rows=${recentCorrectionRows.length} days=${RECENT_CORRECTION_RECHECK_DAYS}`
  );
}

const ids=[...affected].sort((a,b)=>a-b);
console.log(`cache_mode=${mode}`);
console.log(`racer_total=${currentRegnos.length}`);
console.log(`cache_existing=${cachedSet.size}`);
console.log(`venue_course_cache_existing=${venueCourseCachedSet.size}`);
console.log(`cache_refresh_racers=${ids.length}`);
console.log(`cache_reuse_racers=${Math.max(0,currentRegnos.length-ids.length)}`);

if(ids.length){
  console.log("refresh course rows...");
  const courseRows=await fetchBatched("wake_dictionary_course_stats_v1",ids,{
    select:"regno,course,n,win_n,ren2_n,ren3_n,avg_st,f_count,l_count,st_missing_count",
    order:"regno.asc,course.asc",batchSize:COURSE_BATCH,
  });
  console.log("refresh venue rows...");
  const venueRows=await fetchBatched("wake_dictionary_venue_stats_v1",ids,{
    select:"*",order:"regno.asc,place_no.asc",batchSize:VENUE_BATCH,
  });
  console.log("refresh kimarite rows...");
  const kimRows=await fetchBatched("wake_dictionary_win_kimarite_v1",ids,{
    select:"regno,course,kimarite,win_n,kimarite_n",
    order:"regno.asc,course.asc,kimarite.asc",batchSize:KIM_BATCH,
  });
  console.log("refresh defense raw rows...");
  const defenseRows=await fetchBatched("wake_dictionary_defense_raw_1y_v1",ids,{
    select:"regno,defense_type,victim_course,n,finish_sum,top3_n,period_start,period_end",
    order:"regno.asc,defense_type.asc,victim_course.asc",batchSize:DEF_BATCH,
  });

  const c=groupBy(courseRows,"regno"), v=groupBy(venueRows,"regno"), k=groupBy(kimRows,"regno"), d=groupBy(defenseRows,"regno");
  const nameByRegno=new Map(racers.map(r=>[Number(r.regno),r.racer_name||""]));
  const now=new Date().toISOString();
  const payload=ids.map(regno=>({
    regno,
    racer_name:nameByRegno.get(regno)||"",
    course_rows:c.get(String(regno))||[],
    venue_rows:v.get(String(regno))||[],
    kimarite_rows:k.get(String(regno))||[],
    defense_rows:d.get(String(regno))||[],
    refreshed_at:now,
    data_end:currentEnd,
    period_start_24m:currentStart,
    defense_start_1y:currentDefenseStart,
  }));
  await upsert("wake_dictionary_incremental_cache_v1",payload,"regno");

  console.log("refresh venue×course×kimarite rows...");
  const vcBatches = chunk(ids, VENUE_COURSE_BATCH);
  for (let i = 0; i < vcBatches.length; i++) {
    const batchIds = vcBatches[i];
    const rows = await fetchVenueCourseChunkAdaptive(batchIds);
    const grouped = groupBy(rows, "regno");
    const nowVc = new Date().toISOString();

    const payloadVc = batchIds.map((regno) => ({
      regno,
      rows: grouped.get(String(regno)) || [],
      refreshed_at: nowVc,
      data_end: currentEnd,
      period_start_24m: currentStart,
    }));

    await upsert("wake_dictionary_venue_course_cache_v1", payloadVc, "regno");
    console.log(
      `venue_course_cache: batch ${i+1}/${vcBatches.length} racers=${batchIds.length} rows=${rows.length}`
    );
  }
}

// State is written only after every affected racer has been refreshed successfully.
await upsert("wake_dictionary_incremental_state_v1",[{
  id:1,
  last_data_end:currentEnd,
  period_start_24m:currentStart,
  defense_start_1y:currentDefenseStart,
  raw_rows:currentRawRows,
  updated_at:new Date().toISOString(),
}],"id");

console.log(`cache_state_data_end=${currentEnd}`);
console.log("WAKE dictionary v2.3.2 incremental cache refresh complete");
