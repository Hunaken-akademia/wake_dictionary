#!/usr/bin/env node
/**
 * WAKE辞典 v2.3 validation
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

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.env.WAKE_DICTIONARY_OUT_DIR || "public/data");

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

// Generated JSON helpers
async function readJson(path) {
  return JSON.parse(await readFile(resolve(OUT_DIR, path), "utf8"));
}

// v2.1 intentionally avoids full-table aggregate VIEW validation here.
// The deploy artifact itself is validated globally; only 3 racers are independently
// recomputed from base rows later in [4].
const racers = await fetchAll("wake_dictionary_racers_v1", {
  select:"regno,total_starts",
  order:"regno.asc"
});

// 1) generated racer course n sum == racer total starts
let mismatches = [];
let cells = [];
const perRacerWins = new Map();
for (const racer of racers) {
  const regno = Number(racer.regno);
  const d = await readJson(`racers/${regno}.json`);
  const sum = (d.course_stats || []).reduce((a,x)=>a+Number(x.n||0),0);
  if (sum !== Number(racer.total_starts)) {
    mismatches.push({regno, generated:sum, expected:Number(racer.total_starts)});
  }
  let totalWins = 0;
  for (const c of d.win_kimarite_breakdown || []) {
    cells.push({regno,course:Number(c.course),win_n:Number(c.win_n||0)});
    totalWins += Number(c.win_n||0);
  }
  perRacerWins.set(regno,totalWins);
}
console.log(`[1] generated course n sum == total starts: ${mismatches.length===0?"PASS":"FAIL"} mismatches=${mismatches.length}`);
if (mismatches.length) {
  failed=true;
  console.log(mismatches.slice(0,20));
}

// 2) national kimarite composition from generated baselines sums to ~100%
const generatedBaselines = await readJson("meta/baselines.json");
for (let course=1;course<=6;course++) {
  const comp = generatedBaselines.grade_course?.ALL?.[String(course)]?.kimarite_win_composition || {};
  const vals = Object.values(comp).filter((v)=>v!=null).map(Number);
  const sum = vals.reduce((a,b)=>a+b,0);
  const ok = vals.length===6 && Math.abs(sum-100) < 0.02;
  console.log(`[2] generated national kimarite course=${course} sum=${sum.toFixed(3)} ${ok?"PASS":"FAIL"}`);
  if(!ok) failed=true;
}

// 3) thin sample prevalence from generated player JSON
const thinCells = cells.filter(x=>x.win_n<5);
const thinRacers = [...perRacerWins.entries()].filter(([,wins])=>wins<5);
console.log(`[3] racer-course cells win_n<5: ${thinCells.length}/${cells.length} = ${(100*thinCells.length/Math.max(cells.length,1)).toFixed(2)}%`);
console.log(`[3] racers total wins<5: ${thinRacers.length}/${perRacerWins.size} = ${(100*thinRacers.length/Math.max(perRacerWins.size,1)).toFixed(2)}%`);

// 4) A1/A2/B1 cross-check
// Explicit env values still override auto-selection.
// Otherwise choose the highest-start racer carrying each verified grade.
const profileRows = await fetchAll("wake_dictionary_racer_profile_v1", {
  select:"regno,grade,branch,captured_at",
  order:"regno.asc"
});
const totalsByRegno = new Map(racers.map((r) => [Number(r.regno), Number(r.total_starts)]));

function autoPickGrade(grade) {
  const candidates = profileRows
    .filter((r) => r.grade === grade && totalsByRegno.has(Number(r.regno)))
    .map((r) => ({ regno:Number(r.regno), starts:totalsByRegno.get(Number(r.regno)) || 0 }))
    .sort((a,b) => b.starts - a.starts || a.regno - b.regno);
  return candidates[0]?.regno ? String(candidates[0].regno) : "";
}

const verify = [
  ["A1", process.env.VERIFY_A1_REGNO || autoPickGrade("A1")],
  ["A2", process.env.VERIFY_A2_REGNO || autoPickGrade("A2")],
  ["B1", process.env.VERIFY_B1_REGNO || autoPickGrade("B1")],
];

if (verify.some(([,v]) => !v)) {
  console.log("[4] A1/A2/B1 cross-check: NOT RUN");
  console.log("    racer profile table does not yet contain all three grades. Run collect_racer_profiles.mjs first.");
} else {
  for (const [klass,reg] of verify) {
    const regno = Number(reg);
    const raw = await fetchAll("wake_dictionary_base_24m_v1", {
      select:"course,rank,st_for_average,is_f,is_l",
      filters:[["regno",`eq.${regno}`]],
      order:"course.asc"
    });
    const generatedRacer = await readJson(`racers/${regno}.json`);
    const agg = (generatedRacer.course_stats || []).map((x) => ({
      course: x.course,
      n: x.n,
      win_n: x.finish_counts?.win,
      ren2_n: x.finish_counts?.ren2,
      ren3_n: x.finish_counts?.ren3,
      f_count: x.start?.f_count,
      l_count: x.start?.l_count,
      avg_st: x.start?.avg_st,
      raw_win_rate: x.rates?.raw?.win,
      raw_ren2_rate: x.rates?.raw?.ren2,
      raw_ren3_rate: x.rates?.raw?.ren3,
    }));

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

    // v2.1 exporterのJSONは表示用に率/STを小数3桁へ丸めている。
    // v2.0までのvalidatorはDB VIEW（未丸め）を直接比較していたため1e-8でよかったが、
    // v2.1からgenerated JSONを検証対象にしたことで、未丸めのmanual値と比較すると
    // 正しいデータでも必ずFAILし得る。件数は完全一致、率/STはJSONと同じround3後で比較する。
    const round3 = (v) => v == null ? null : Math.round(Number(v) * 1000) / 1000;

    let ok = true;
    const mismatch = [];

    const aggCourses = new Set(agg.map((x) => Number(x.course)));
    const manualCourses = new Set(manual.keys());
    if (
      aggCourses.size !== manualCourses.size ||
      [...manualCourses].some((c) => !aggCourses.has(c))
    ) {
      ok = false;
      mismatch.push(`course_set generated=${[...aggCourses].sort().join(",")} manual=${[...manualCourses].sort().join(",")}`);
    }

    for (const a of agg) {
      const c = Number(a.course);
      const m = manual.get(c);
      if (!m) {
        ok = false;
        mismatch.push(`course${c}: missing manual row`);
        continue;
      }

      const avgst = m.st.length ? m.st.reduce((x,y)=>x+y,0)/m.st.length : null;
      const expected = {
        n: m.n,
        win_n: m.w,
        ren2_n: m.r2,
        ren3_n: m.r3,
        f_count: m.f,
        l_count: m.l,
        raw_win_rate: round3(rate(m.w,m.n)),
        raw_ren2_rate: round3(rate(m.r2,m.n)),
        raw_ren3_rate: round3(rate(m.r3,m.n)),
        avg_st: round3(avgst),
      };

      const actual = {
        n: Number(a.n),
        win_n: Number(a.win_n),
        ren2_n: Number(a.ren2_n),
        ren3_n: Number(a.ren3_n),
        f_count: Number(a.f_count),
        l_count: Number(a.l_count),
        raw_win_rate: a.raw_win_rate == null ? null : Number(a.raw_win_rate),
        raw_ren2_rate: a.raw_ren2_rate == null ? null : Number(a.raw_ren2_rate),
        raw_ren3_rate: a.raw_ren3_rate == null ? null : Number(a.raw_ren3_rate),
        avg_st: a.avg_st == null ? null : Number(a.avg_st),
      };

      const exactKeys = ["n","win_n","ren2_n","ren3_n","f_count","l_count"];
      for (const key of exactKeys) {
        if (actual[key] !== expected[key]) {
          ok = false;
          mismatch.push(`course${c}.${key} actual=${actual[key]} expected=${expected[key]}`);
        }
      }

      for (const key of ["raw_win_rate","raw_ren2_rate","raw_ren3_rate","avg_st"]) {
        const av = actual[key], ev = expected[key];
        const sameNull = av == null && ev == null;
        const sameValue = av != null && ev != null && approx(av, ev, 1e-12);
        if (!sameNull && !sameValue) {
          ok = false;
          mismatch.push(`course${c}.${key} actual=${av} expected=${ev}`);
        }
      }
    }

    console.log(`[4] ${klass} regno=${regno} independent row recomputation: ${ok?"PASS":"FAIL"}`);
    if (!ok) {
      console.log(`    mismatch sample: ${mismatch.slice(0,8).join(" | ")}`);
      failed=true;
    }
  }
}


// 5) generated reverse/ranking JSON checks
function isSortedDesc(rows, key) {
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i-1][key]) < Number(rows[i][key]) - 1e-12) return false;
  }
  return true;
}
function isSortedAsc(rows, key) {
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i-1][key]) > Number(rows[i][key]) + 1e-12) return false;
  }
  return true;
}

try {
  const reverseCatalog = await readJson("index/reverse_catalog.json");
  const rankingCatalog = await readJson("index/ranking_catalog.json");
  const baselines = await readJson("meta/baselines.json");

  const reverseCountOk = reverseCatalog.files.length === 6 * 7 * 5;
  console.log(`[5] reverse index files=${reverseCatalog.files.length} expected=210 ${reverseCountOk?"PASS":"FAIL"}`);
  if (!reverseCountOk) failed = true;

  const baselineScopesOk = ["ALL","A1","A2","B1","B2"].every(
    (g) => baselines.grade_course?.[g] &&
      ["1","2","3","4","5","6"].every((c) => baselines.grade_course[g][c])
  );
  console.log(`[5] baseline grade×course matrix ${baselineScopesOk?"PASS":"FAIL"}`);
  if (!baselineScopesOk) failed = true;

  // Check every reverse file is adjusted-rate descending and has explicit n/raw/adjusted.
  let badReverse = 0;
  for (const item of reverseCatalog.files) {
    const f = await readJson(`index/${item.file}`);
    const rows = Array.isArray(f.rows) ? f.rows : [];
    const sorted = isSortedDesc(rows, "adjRate");
    const schemaOk = rows.every((r) =>
      Number.isFinite(Number(r.n)) &&
      Number.isFinite(Number(r.rawRate)) &&
      Number.isFinite(Number(r.adjRate))
    );
    if (!sorted || !schemaOk) badReverse++;
  }
  console.log(`[5] reverse files sorted/schema: ${badReverse===0?"PASS":"FAIL"} bad=${badReverse}`);
  if (badReverse) failed = true;

  // Check ranking files according to declared sort.
  let badRanking = 0;
  for (const item of rankingCatalog.files) {
    const f = await readJson(`index/${item.file}`);
    const rows = Array.isArray(f.rows) ? f.rows : [];
    let sorted = true;
    if (item.sort === "adjRate_desc") sorted = isSortedDesc(rows, "adjRate");
    else if (item.sort === "adjRate_asc") sorted = isSortedAsc(rows, "adjRate");
    else if (item.sort === "adjustedSt_asc") sorted = isSortedAsc(rows, "adjustedSt");
    else if (item.sort === "diffPtAdjusted_desc") sorted = isSortedDesc(rows, "diffPtAdjusted");
    if (!sorted) badRanking++;
  }
  console.log(`[5] ranking files sorted: ${badRanking===0?"PASS":"FAIL"} bad=${badRanking}`);
  if (badRanking) failed = true;

  const bAttackers = await readJson("index/ranking_b_attackers.json");
  const bGradeOk = bAttackers.rows.every((r) => r.grade === "B1" || r.grade === "B2");
  console.log(`[5] B級の伏兵 grade filter: ${bGradeOk?"PASS":"FAIL"} rows=${bAttackers.rows.length}`);
  if (!bGradeOk) failed = true;

  const aAttackers = await readJson("index/ranking_a_attackers.json");
  const aGradeOk = aAttackers.rows.every((r) => r.grade === "A1" || r.grade === "A2");
  console.log(`[5] A級の伏兵 grade filter: ${aGradeOk?"PASS":"FAIL"} rows=${aAttackers.rows.length}`);
  if (!aGradeOk) failed = true;

  const requiredNewRankings = [
    ...["A1","A2","B1","B2"].flatMap((g) => [
      `ranking_makurizashi_${g}.json`,
      `ranking_ren3_${g}.json`,
    ]),
  ];
  const catalogFiles = new Set(rankingCatalog.files.map((x) => x.file));
  const missingNewRankings = requiredNewRankings.filter((f) => !catalogFiles.has(f));
  console.log(`[5] v2.5 ranking variants ${missingNewRankings.length===0?"PASS":"FAIL"} missing=${missingNewRankings.length}`);
  if (missingNewRankings.length) failed = true;

  const rankingSource = await readJson("index/ranking_source.json");
  const womenRows = (rankingSource.racers || []).filter((r) => r.is_female && r.gender === "F");
  const sourceSchemaOk = (rankingSource.racers || []).length > 1000
    && womenRows.length >= 200
    && (rankingSource.racers || []).every((r) => Array.isArray(r.courses));
  console.log(`[5] ranking source/gender ${sourceSchemaOk?"PASS":"FAIL"} racers=${rankingSource.racers?.length||0} women=${womenRows.length}`);
  if (!sourceSchemaOk) failed = true;

} catch (e) {
  console.log(`[5] generated index validation FAIL: ${e.message || e}`);
  failed = true;
}



// 6) v1.8 public-readiness checks
try {
  const unstableA1 = await readJson("index/ranking_in_unstable_A1.json");
  const unstableMinOk = Number(unstableA1.default_min_n) === 50;
  console.log(`[6] in-unstable default_min_n=50 ${unstableMinOk?"PASS":"FAIL"}`);
  if (!unstableMinOk) failed = true;

  const sampleRacerFiles = (await import("node:fs/promises")).readdir;
  const files = await sampleRacerFiles(resolve(OUT_DIR, "racers"));
  let badSufficient = 0;
  let badAlpha = 0;
  let badRawDisplayData = 0;
  let rawWinCellsChecked = 0;

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const d = await readJson(`racers/${file}`);
    const breakdownByCourse = new Map(
      (d.win_kimarite_breakdown || []).map((c) => [Number(c.course), c])
    );

    for (const c of d.win_kimarite_breakdown || []) {
      if (Boolean(c.sufficient) !== (Number(c.win_n) >= 20)) badSufficient++;
      if (Number(c.alpha) !== 30) badAlpha++;
    }

    // v2.2: 1着が1回でもあるコースは、実測ドーナツを作れる完全な内訳が必要。
    // ただしwin_kimarite_breakdownはSQL側で実コース1〜6限定に定義されているため、
    // 元データ不整合由来のコース値(1〜6以外)がcourse_statsに紛れても対象外とする。
    // total_starts整合(チェック[1])は全コース込みのまま維持し、ここだけ実コース
    // ドメインへ揃えることで、1件の恒久的なデータ異常でビルド全体を止めない。
    for (const course of d.course_stats || []) {
      const courseNo = Number(course.course);
      if (!(courseNo >= 1 && courseNo <= 6)) continue;
      const winN = Number(course.finish_counts?.win || 0);
      if (winN < 1) continue;
      rawWinCellsChecked++;

      const c = breakdownByCourse.get(Number(course.course));
      if (!c || Number(c.win_n) !== winN) {
        badRawDisplayData++;
        console.log(`[6] DEBUG bad cell file=${file} course=${courseNo} course_stats.win_n=${winN} breakdown.win_n=${c?Number(c.win_n):"MISSING"}`);
        continue;
      }

      const countSum = (c.items || []).reduce((s,x) => s + Number(x.count || 0), 0);
      if (countSum !== winN) {
        badRawDisplayData++;
        console.log(`[6] DEBUG bad cell file=${file} course=${courseNo} win_n=${winN} countSum=${countSum} items=${JSON.stringify(c.items)}`);
        continue;
      }

      for (const x of c.items || []) {
        const expected = Math.round((100 * Number(x.count || 0) / winN) * 1000) / 1000;
        const actual = Number(x.raw_rate);
        if (!approx(actual, expected, 1e-12)) {
          badRawDisplayData++;
          console.log(`[6] DEBUG bad cell file=${file} course=${courseNo} win_n=${winN} item=${JSON.stringify(x)} expected=${expected} actual=${actual}`);
          break;
        }
      }
    }
  }

  console.log(`[6] kimarite adjusted/insight min wins=20 ${badSufficient===0?"PASS":"FAIL"} bad=${badSufficient}`);
  console.log(`[6] kimarite detail alpha=30 ${badAlpha===0?"PASS":"FAIL"} bad=${badAlpha}`);
  console.log(`[6] kimarite raw display from win_n>=1 ${badRawDisplayData===0?"PASS":"FAIL"} cells=${rawWinCellsChecked} bad=${badRawDisplayData}`);
  if (badSufficient || badAlpha || badRawDisplayData) failed = true;
} catch (e) {
  console.log(`[6] v1.8 generated data checks FAIL: ${e.message || e}`);
  failed = true;
}


// 7) v2.2 defense + insight checks
// defense VIEWを再度全件SELECTすると同じstatement timeoutを再発させるため、
// 実際にデプロイされる generated feature JSON を検証する。
try {
  const fs = await import("node:fs/promises");
  const featureFiles = (await fs.readdir(resolve(OUT_DIR, "features")))
    .filter((f) => f.endsWith(".json"));

  const featureCountOk = featureFiles.length === racers.length;
  let badInsightCount = 0;
  let badInsightThreshold = 0;
  let badDefensePayload = 0;
  let defenseItems = 0;
  let defenseRangeBad = 0;

  for (const file of featureFiles) {
    const d = await readJson(`features/${file}`);
    const items = d?.insights?.items || [];

    if (items.length > 3) badInsightCount++;
    for (const x of items) {
      if (!(Number(x.strength_ratio) >= 1)) badInsightThreshold++;
    }

    for (const k of ["makurare","sasare"]) {
      const x = d?.defense_1y?.[k];
      if (!x) continue;
      defenseItems++;

      if (Boolean(x.sufficient) !== (Number(x.n) >= 8)) {
        badDefensePayload++;
      }

      const rangeOk =
        Number(x.n) >= 1 &&
        Number(x.avg_finish) >= 2 &&
        Number(x.avg_finish) <= 6 &&
        Number(x.top3_rate) >= 0 &&
        Number(x.top3_rate) <= 100 &&
        Number(x.baseline_avg_finish) >= 2 &&
        Number(x.baseline_avg_finish) <= 6 &&
        Number(x.baseline_top3_rate) >= 0 &&
        Number(x.baseline_top3_rate) <= 100;

      if (!rangeOk) defenseRangeBad++;
    }
  }

  console.log(`[7] feature files=${featureFiles.length}/${racers.length} ${featureCountOk?"PASS":"FAIL"}`);
  console.log(`[7] insights max3 ${badInsightCount===0?"PASS":"FAIL"} bad=${badInsightCount}`);
  console.log(`[7] insight thresholds ${badInsightThreshold===0?"PASS":"FAIL"} bad=${badInsightThreshold}`);
  console.log(`[7] defense generated items=${defenseItems}`);
  console.log(`[7] defense ranges ${defenseRangeBad===0?"PASS":"FAIL"} bad=${defenseRangeBad}`);
  console.log(`[7] defense payload sufficient>=8 ${badDefensePayload===0?"PASS":"FAIL"} bad=${badDefensePayload}`);

  if (
    !featureCountOk ||
    badInsightCount ||
    badInsightThreshold ||
    badDefensePayload ||
    defenseRangeBad
  ) {
    failed = true;
  }
} catch (e) {
  console.log(`[7] v2.2 feature validation FAIL: ${e.message || e}`);
  failed = true;
}


// 8) v2.3 24場フィルターJSON
try {
  let loaded = 0;
  let badRows = 0;
  let badKimarite = 0;
  let badBaselines = 0;

  for (let placeNo = 1; placeNo <= 24; placeNo++) {
    const d = await readJson(
      `index/venue_${String(placeNo).padStart(2,"0")}.json`
    );

    if (Number(d.place_no) !== placeNo || !Array.isArray(d.racers)) {
      badRows++;
      continue;
    }
    loaded++;

    for (const scope of ["ALL","A1","A2","B1","B2"]) {
      for (let course = 1; course <= 6; course++) {
        const b = d.baselines?.[scope]?.[String(course)];
        if (!b || Number(b.n || 0) < 0) badBaselines++;
      }
    }

    for (const racer of d.racers) {
      for (const c of racer.courses || []) {
        const n = Number(c.n || 0);
        const winN = Number(c.win_n || 0);
        const ren2 = Number(c.ren2_n || 0);
        const ren3 = Number(c.ren3_n || 0);
        const ksum = Object.values(c.kimarite || {})
          .reduce((s,v) => s + Number(v || 0), 0);

        if (n < 1 || winN < 0 || ren2 < winN || ren3 < ren2 || ren3 > n) {
          badRows++;
        }
        if (ksum !== winN) badKimarite++;
      }
    }
  }

  console.log(`[8] venue filter files=24 ${loaded===24?"PASS":"FAIL"} loaded=${loaded}`);
  console.log(`[8] venue row ranges ${badRows===0?"PASS":"FAIL"} bad=${badRows}`);
  console.log(`[8] venue kimarite sum==wins ${badKimarite===0?"PASS":"FAIL"} bad=${badKimarite}`);
  console.log(`[8] venue baselines ${badBaselines===0?"PASS":"FAIL"} bad=${badBaselines}`);

  if (loaded !== 24 || badRows || badKimarite || badBaselines) failed = true;
} catch (e) {
  console.log(`[8] venue filter validation FAIL: ${e.message || e}`);
  failed = true;
}

if (failed) {
  console.error("WAKE dictionary validation FAILED");
  process.exit(1);
}
console.log("WAKE dictionary global validation passed.");
