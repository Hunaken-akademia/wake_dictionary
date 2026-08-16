#!/usr/bin/env node
/**
 * WAKE辞典 v1 validation
 *
 * Global checks:
 *  - racer course n sum == racer total starts
 *  - national kimarite distribution sums to 100% for each course
 *  - report thin-sample prevalence (win_n < 5)
 *
 * Cross-check 3 real racers:
 *  Because audited DB has no grade field, A1/A2/B1 cannot be auto-selected safely.
 *  Provide verified registration numbers:
 *    VERIFY_A1_REGNO
 *    VERIFY_A2_REGNO
 *    VERIFY_B1_REGNO
 *
 * The script compares aggregate-view course results with an independent recomputation
 * from wake_dictionary_base_24m_v1 row data for those racers.
 */

const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_URL = RAW_SUPABASE_URL
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || "");
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY required");

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const PAGE_SIZE = 1000;

async function fetchAll(resource, { select="*", order="", filters=[] }={}) {
  const out = [];
  for (let offset=0;;offset+=PAGE_SIZE) {
    const q = new URLSearchParams({ select, limit:String(PAGE_SIZE), offset:String(offset) });
    if (order) q.set("order", order);
    for (const [k,v] of filters) q.append(k,v);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${q}`, { headers });
    const t = await r.text();
    if (!r.ok) throw new Error(`${resource} ${r.status}: ${t.slice(0,1000)}`);
    const rows = t ? JSON.parse(t) : [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function approx(a,b,eps=1e-9){ return Math.abs(Number(a)-Number(b)) <= eps; }
function rate(num,den){ return den ? 100*num/den : 0; }

let failed = false;

// 1) n sum check
const racers = await fetchAll("wake_dictionary_racers_v1", { select:"regno,total_starts", order:"regno.asc" });
const courses = await fetchAll("wake_dictionary_course_stats_v1", { select:"regno,course,n", order:"regno.asc,course.asc" });
const sums = new Map();
for (const r of courses) sums.set(Number(r.regno), (sums.get(Number(r.regno))||0)+Number(r.n));
const mismatches = racers.filter(r => (sums.get(Number(r.regno))||0) !== Number(r.total_starts));
console.log(`[1] course n sum == total starts: ${mismatches.length === 0 ? "PASS" : "FAIL"} mismatches=${mismatches.length}`);
if (mismatches.length) {
  failed = true;
  console.log(mismatches.slice(0,20));
}

// 2) national kimarite 100%
const nk = await fetchAll("wake_dictionary_national_win_kimarite_v1", { order:"course.asc,kimarite.asc" });
const byCourse = new Map();
for (const r of nk) byCourse.set(Number(r.course), (byCourse.get(Number(r.course))||0)+Number(r.national_rate));
for (const [course,sum] of [...byCourse.entries()].sort((a,b)=>a[0]-b[0])) {
  const ok = Math.abs(sum-100) < 1e-7;
  console.log(`[2] national kimarite course=${course} sum=${sum.toFixed(9)} ${ok?"PASS":"FAIL"}`);
  if (!ok) failed = true;
}

// 3) thin sample prevalence
const wk = await fetchAll("wake_dictionary_win_kimarite_v1", {
  select:"regno,course,win_n,sufficient",
  order:"regno.asc,course.asc"
});
const seen = new Map();
for (const r of wk) {
  const k = `${r.regno}|${r.course}`;
  if (!seen.has(k)) seen.set(k, { regno:Number(r.regno), course:Number(r.course), win_n:Number(r.win_n) });
}
const cells = [...seen.values()];
const thinCells = cells.filter(x => x.win_n < 5);
const perRacerWins = new Map();
for (const x of cells) perRacerWins.set(x.regno, (perRacerWins.get(x.regno)||0)+x.win_n);
const thinRacers = [...perRacerWins.entries()].filter(([,wins]) => wins < 5);

console.log(`[3] racer-course cells win_n<5: ${thinCells.length}/${cells.length} = ${(100*thinCells.length/Math.max(cells.length,1)).toFixed(2)}%`);
console.log(`[3] racers total wins<5: ${thinRacers.length}/${perRacerWins.size} = ${(100*thinRacers.length/Math.max(perRacerWins.size,1)).toFixed(2)}%`);

// 4) A1/A2/B1 cross-check
const verify = [
  ["A1", process.env.VERIFY_A1_REGNO],
  ["A2", process.env.VERIFY_A2_REGNO],
  ["B1", process.env.VERIFY_B1_REGNO],
];

if (verify.some(([,v]) => !v)) {
  console.log("[4] A1/A2/B1 cross-check: NOT RUN");
  console.log("    audited schema has no grade field; set VERIFY_A1_REGNO / VERIFY_A2_REGNO / VERIFY_B1_REGNO using externally verified current classes.");
} else {
  for (const [klass,reg] of verify) {
    const regno = Number(reg);
    const raw = await fetchAll("wake_dictionary_base_24m_v1", {
      select:"course,rank,st_for_average,is_f,is_l",
      filters:[["regno",`eq.${regno}`]],
      order:"course.asc"
    });
    const agg = await fetchAll("wake_dictionary_course_stats_v1", {
      filters:[["regno",`eq.${regno}`]],
      order:"course.asc"
    });

    const manual = new Map();
    for (const r of raw) {
      const c = Number(r.course);
      if (!manual.has(c)) manual.set(c,{n:0,w:0,r2:0,r3:0,st:[],f:0,l:0});
      const x = manual.get(c);
      x.n++;
      const rank = r.rank == null ? null : Number(r.rank);
      if (rank===1) x.w++;
      if (rank!=null && rank<=2) x.r2++;
      if (rank!=null && rank<=3) x.r3++;
      if (r.st_for_average!=null) x.st.push(Number(r.st_for_average));
      if (r.is_f) x.f++;
      if (r.is_l) x.l++;
    }

    let ok = true;
    for (const a of agg) {
      const c = Number(a.course);
      const m = manual.get(c);
      if (!m) { ok=false; continue; }
      const avgst = m.st.length ? m.st.reduce((x,y)=>x+y,0)/m.st.length : null;
      const checks = [
        Number(a.n)===m.n,
        Number(a.win_n)===m.w,
        Number(a.ren2_n)===m.r2,
        Number(a.ren3_n)===m.r3,
        Number(a.f_count)===m.f,
        Number(a.l_count)===m.l,
        approx(a.raw_win_rate, rate(m.w,m.n), 1e-8),
        approx(a.raw_ren2_rate, rate(m.r2,m.n), 1e-8),
        approx(a.raw_ren3_rate, rate(m.r3,m.n), 1e-8),
        (a.avg_st==null && avgst==null) || approx(a.avg_st,avgst,1e-8),
      ];
      if (checks.some(v=>!v)) ok=false;
    }
    console.log(`[4] ${klass} regno=${regno} independent row recomputation: ${ok?"PASS":"FAIL"}`);
    if (!ok) failed=true;
  }
}

if (failed) {
  console.error("WAKE dictionary validation FAILED");
  process.exit(1);
}
console.log("WAKE dictionary global validation passed.");
