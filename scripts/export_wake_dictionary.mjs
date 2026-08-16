#!/usr/bin/env node
/**
 * WAKE辞典 JSON exporter v2.0
 *
 * v1.5.4:
 *   - metadata / racers / profiles の初期取得も完全逐次化
 *   - 57014時のみ最大4回リトライ
 *   - 集計式・SQL・JSON仕様は変更しない
 *
 * v1.2.4:
 *   - 重い集計VIEWを同時実行せず、順番に取得
 *   - 決まり手VIEWは5選手ずつ
 *   - 57014 statement timeout時は、そのバッチだけ自動で半分に再分割
 *   - 1選手まで分割してもtimeoutする場合だけエラー終了
 *   DBスキーマ・集計ロジックは変更しない。
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Optional:
 *   WAKE_DICTIONARY_OUT_DIR  default: public/data
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_URL = RAW_SUPABASE_URL
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || "");
const OUT_DIR = resolve(process.env.WAKE_DICTIONARY_OUT_DIR || "public/data");
const PAGE_SIZE = 1000;
const RACER_BATCH_SIZE = Math.max(5, Number(process.env.WAKE_RACER_BATCH_SIZE || 50));
const VENUE_BATCH_SIZE = Math.max(5, Number(process.env.WAKE_VENUE_BATCH_SIZE || 50));
const KIMARITE_BATCH_SIZE = Math.max(2, Number(process.env.WAKE_KIMARITE_BATCH_SIZE || 10));

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are required");
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function fetchAll(resource, { select = "*", order = "", filters = [] } = {}) {
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const qs = new URLSearchParams();
    qs.set("select", select);
    qs.set("limit", String(PAGE_SIZE));
    qs.set("offset", String(offset));
    if (order) qs.set("order", order);
    for (const [k, v] of filters) qs.append(k, v);

    const url = `${SUPABASE_URL}/rest/v1/${resource}?${qs}`;
    const res = await fetch(url, { headers });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${resource} ${res.status}: ${text.slice(0, 1000)}`);
    }

    const rows = text ? JSON.parse(text) : [];
    if (!Array.isArray(rows)) throw new Error(`${resource}: expected array response`);
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function isStatementTimeout(error) {
  const s = String(error?.message || error || "");
  return s.includes('"code":"57014"') || s.includes("statement timeout");
}


function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchAllWithTimeoutRetry(
  resource,
  options = {},
  { attempts = 4, baseDelayMs = 1500 } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchAll(resource, options);
    } catch (error) {
      lastError = error;
      if (!isStatementTimeout(error) || attempt === attempts) throw error;

      const delay = baseDelayMs * attempt;
      console.warn(
        `${resource}: statement timeout attempt ${attempt}/${attempts}; retry in ${delay}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

async function fetchRacerChunkAdaptive(
  resource,
  ids,
  { order = "regno.asc", select = "*", depth = 0 } = {}
) {
  const filter = `in.(${ids.join(",")})`;

  try {
    return await fetchAll(resource, {
      select,
      order,
      filters: [["regno", filter]],
    });
  } catch (error) {
    if (!isStatementTimeout(error) || ids.length <= 1) throw error;

    const mid = Math.ceil(ids.length / 2);
    const left = ids.slice(0, mid);
    const right = ids.slice(mid);

    console.warn(
      `${resource}: statement timeout for ${ids.length} racers; split -> ${left.length}+${right.length}`
    );

    // Sequential on purpose: avoid making Supabase compute multiple heavy views at once.
    const a = await fetchRacerChunkAdaptive(resource, left, {
      order,
      select,
      depth: depth + 1,
    });
    const b = await fetchRacerChunkAdaptive(resource, right, {
      order,
      select,
      depth: depth + 1,
    });
    return [...a, ...b];
  }
}

async function fetchByRacerBatches(
  resource,
  racers,
  { order = "regno.asc", select = "*", batchSize = RACER_BATCH_SIZE } = {}
) {
  const regnos = racers.map((r) => Number(r.regno)).filter(Number.isFinite);
  const batches = chunk(regnos, batchSize);
  const all = [];

  for (let i = 0; i < batches.length; i++) {
    const ids = batches[i];
    const rows = await fetchRacerChunkAdaptive(resource, ids, {
      select,
      order,
    });
    all.push(...rows);
    console.log(
      `${resource}: batch ${i + 1}/${batches.length} racers=${ids.length} rows=${rows.length}`
    );
  }

  return all;
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function pct(v) {
  const x = n(v);
  return x === null ? null : Math.round(x * 1000) / 1000;
}
function st(v) {
  const x = n(v);
  return x === null ? null : Math.round(x * 1000) / 1000;
}
function groupBy(rows, key) {
  const m = new Map();
  for (const row of rows) {
    const k = String(row[key]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }
  return m;
}
function compactJson(v) {
  return JSON.stringify(v);
}
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, compactJson(value) + "\n", "utf8");
}


const SHRINK_K = 15;
const KIMARITE_COMPOSITION_ALPHA = 30;
const KIMARITE_COMPOSITION_MIN_WINS = 20;
const GRADES = ["A1", "A2", "B1", "B2"];
const GRADE_SCOPES = ["ALL", ...GRADES];
const KIMARITE_KINDS = [
  { name: "逃げ", slug: "nige" },
  { name: "差し", slug: "sashi" },
  { name: "まくり", slug: "makuri" },
  { name: "まくり差し", slug: "makurizashi" },
  { name: "抜き", slug: "nuki" },
  { name: "恵まれ", slug: "megumare" },
];

function safeDiv(num, den) {
  return den > 0 ? num / den : 0;
}
function ratePct(num, den) {
  return 100 * safeDiv(num, den);
}
function shrinkRatePct(count, total, baselinePct, k = SHRINK_K) {
  if (!(total >= 0) || baselinePct == null) return null;
  return 100 * (count + k * (baselinePct / 100)) / (total + k);
}
function shrinkMean(sum, total, baselineMean, k = SHRINK_K) {
  if (!(total >= 0) || baselineMean == null) return null;
  return (sum + k * baselineMean) / (total + k);
}
function sortDescAdjusted(a, b) {
  return (
    Number(b.adjRate ?? -Infinity) - Number(a.adjRate ?? -Infinity) ||
    Number(b.rawRate ?? -Infinity) - Number(a.rawRate ?? -Infinity) ||
    Number(b.n ?? 0) - Number(a.n ?? 0) ||
    Number(a.regno) - Number(b.regno)
  );
}
function sortAscAdjusted(a, b) {
  return (
    Number(a.adjRate ?? Infinity) - Number(b.adjRate ?? Infinity) ||
    Number(a.rawRate ?? Infinity) - Number(b.rawRate ?? Infinity) ||
    Number(b.n ?? 0) - Number(a.n ?? 0) ||
    Number(a.regno) - Number(b.regno)
  );
}
function makeAccumulator() {
  return {
    starts: 0,
    wins: 0,
    ren2: 0,
    ren3: 0,
    validStN: 0,
    stSum: 0,
    fCount: 0,
    lCount: 0,
    kimarite: Object.fromEntries(KIMARITE_KINDS.map((k) => [k.name, 0])),
  };
}
function addCourseToAccumulator(acc, courseRow, kimRowsForCourse) {
  const starts = Number(courseRow?.n || 0);
  const fCount = Number(courseRow?.f_count || 0);
  const lCount = Number(courseRow?.l_count || 0);
  const otherMissing = Number(courseRow?.st_missing_count || 0);
  const validStN = Math.max(0, starts - fCount - lCount - otherMissing);
  const avgSt = n(courseRow?.avg_st);

  acc.starts += starts;
  acc.wins += Number(courseRow?.win_n || 0);
  acc.ren2 += Number(courseRow?.ren2_n || 0);
  acc.ren3 += Number(courseRow?.ren3_n || 0);
  acc.validStN += validStN;
  if (avgSt != null) acc.stSum += avgSt * validStN;
  acc.fCount += fCount;
  acc.lCount += lCount;

  for (const row of kimRowsForCourse || []) {
    const kind = String(row.kimarite || "");
    if (kind in acc.kimarite) acc.kimarite[kind] += Number(row.kimarite_n || 0);
  }
}

console.log("WAKE dictionary export start");
console.log(`out=${OUT_DIR}`);
console.log(`course_batch_size=${RACER_BATCH_SIZE}`);
console.log(`venue_batch_size=${VENUE_BATCH_SIZE}`);
console.log(`kimarite_batch_size=${KIMARITE_BATCH_SIZE}`);

// 基本VIEWも同時実行しない。
// metadata_v1 は1行でも内部集計が重いため、racers/profile と並列にすると
// Supabase statement timeoutを起こし得る。
// 57014時だけ短い待機を挟んで最大4回再試行する。
console.log("fetch metadata...");
const metadataRows = await fetchAllWithTimeoutRetry(
  "wake_dictionary_metadata_v1"
);

console.log("fetch racers...");
const racers = await fetchAllWithTimeoutRetry(
  "wake_dictionary_racers_v1",
  { order: "regno.asc" }
);

console.log("fetch racer profiles...");
const racerProfiles = await fetchAllWithTimeoutRetry(
  "wake_dictionary_racer_profile_v1",
  { order: "regno.asc" }
);

console.log("fetch official racer kana...");
const racerKanaRows = await fetchAllWithTimeoutRetry(
  "wake_dictionary_racer_kana_v1",
  { order: "regno.asc" }
);

if (metadataRows.length !== 1) {
  throw new Error(`wake_dictionary_metadata_v1 expected 1 row, got ${metadataRows.length}`);
}

console.log(`racers=${racers.length}`);

// 重い集計VIEWは同時実行しない。
// Supabaseのstatement timeoutを避けるため、順番に取得する。
// さらに各バッチで57014が出た場合は、そのバッチだけ自動で半分ずつ再分割する。
const exportStartedAt = Date.now();
console.log("fetch course stats...");
const courseStats = await fetchByRacerBatches(
  "wake_dictionary_course_stats_v1",
  racers,
  {
    order: "regno.asc,course.asc",
    batchSize: RACER_BATCH_SIZE,
  }
);

console.log("fetch venue stats...");
const venueStats = await fetchByRacerBatches(
  "wake_dictionary_venue_stats_v1",
  racers,
  {
    order: "regno.asc,place_no.asc",
    batchSize: VENUE_BATCH_SIZE,
  }
);

console.log("fetch kimarite stats...");
const kimariteRows = await fetchByRacerBatches(
  "wake_dictionary_win_kimarite_v1",
  racers,
  {
    order: "regno.asc,course.asc,kimarite.asc",
    // このVIEWが最も重いため初期値を小さくする。
    // timeoutしたバッチは自動分割される。
    batchSize: KIMARITE_BATCH_SIZE,
  }
);

console.log("fetch defense stats (last 1 year)...");
const defenseRows = await fetchAllWithTimeoutRetry(
  "wake_dictionary_defense_stats_1y_v1",
  { order: "regno.asc,defense_type.asc" },
  { attempts: 4, baseDelayMs: 2000 }
);

console.log(`heavy_view_fetch_seconds=${((Date.now()-exportStartedAt)/1000).toFixed(1)}`);
const md = metadataRows[0];
const generatedAt = new Date().toISOString();

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(resolve(OUT_DIR, "racers"), { recursive: true });

const byCourse = groupBy(courseStats, "regno");
const byVenue = groupBy(venueStats, "regno");
const byKimarite = groupBy(kimariteRows, "regno");
const profileByRegno = new Map(racerProfiles.map((r) => [String(r.regno), r]));
const kanaByRegno = new Map(racerKanaRows.map((r) => [String(r.regno), r]));
const byDefense = groupBy(defenseRows, "regno");

const period = {
  requested_start: md.requested_start,
  actual_start: md.actual_start,
  actual_end: md.actual_end,
};

const index = [];

for (const racer of racers) {
  const regno = Number(racer.regno);
  const key = String(regno);
  const name = racer.racer_name || "";

  const profile = profileByRegno.get(key) || null;
  const kanaProfile = kanaByRegno.get(key) || null;
  const grade = profile?.grade || null;
  const branch = profile?.branch || null;
  const kana = kanaProfile?.kana_hiragana || null;
  const kana_katakana = kanaProfile?.kana_katakana || null;

  index.push({
    regno,
    name,
    kana,
    kana_katakana,
    grade,
    branch,
  });

  const courses = (byCourse.get(key) || []).map((r) => ({
    course: Number(r.course),
    n: Number(r.n),
    finish_counts: {
      win: Number(r.win_n),
      ren2: Number(r.ren2_n),
      ren3: Number(r.ren3_n),
    },
    start: {
      avg_st: st(r.avg_st),
      f_count: Number(r.f_count),
      l_count: Number(r.l_count),
      other_st_missing_count: Number(r.st_missing_count),
    },
    rates: {
      raw: {
        win: pct(r.raw_win_rate),
        ren2: pct(r.raw_ren2_rate),
        ren3: pct(r.raw_ren3_rate),
      },
      adjusted: {
        win: pct(r.adjusted_win_rate),
        ren2: pct(r.adjusted_ren2_rate),
        ren3: pct(r.adjusted_ren3_rate),
      },
      national_same_course: {
        win: pct(r.national_win_rate),
        ren2: pct(r.national_ren2_rate),
        ren3: pct(r.national_ren3_rate),
      },
      diff_pt_raw: {
        win: pct(r.raw_win_diff_pt),
        ren2: pct(r.raw_ren2_diff_pt),
        ren3: pct(r.raw_ren3_diff_pt),
      },
      diff_pt_adjusted: {
        win: pct(r.adjusted_win_diff_pt),
        ren2: pct(r.adjusted_ren2_diff_pt),
        ren3: pct(r.adjusted_ren3_diff_pt),
      },
      shrinkage: {
        k: 15,
        lambda: pct(r.lambda),
      },
    },
  }));

  const venue = (byVenue.get(key) || []).map((r) => ({
    place_no: Number(r.place_no),
    n: Number(r.n),
    finish_counts: {
      win: Number(r.win_n),
      ren2: Number(r.ren2_n),
      ren3: Number(r.ren3_n),
    },
    start: {
      avg_st: st(r.avg_st),
      f_count: Number(r.f_count),
      l_count: Number(r.l_count),
    },
    rates: {
      raw: {
        win: pct(r.raw_win_rate),
        ren2: pct(r.raw_ren2_rate),
        ren3: pct(r.raw_ren3_rate),
      },
      adjusted: {
        win: pct(r.adjusted_win_rate),
        ren2: pct(r.adjusted_ren2_rate),
        ren3: pct(r.adjusted_ren3_rate),
      },
      personal_all_venue_baseline: {
        n: Number(r.all_n),
        win: pct(r.personal_all_venue_win_rate),
        ren2: pct(r.personal_all_venue_ren2_rate),
        ren3: pct(r.personal_all_venue_ren3_rate),
        avg_st: st(r.personal_all_venue_avg_st),
      },
      diff_pt_raw: {
        win: pct(r.raw_win_diff_pt),
        ren2: pct(r.raw_ren2_diff_pt),
        ren3: pct(r.raw_ren3_diff_pt),
      },
      diff_pt_adjusted: {
        win: pct(r.adjusted_win_diff_pt),
        ren2: pct(r.adjusted_ren2_diff_pt),
        ren3: pct(r.adjusted_ren3_diff_pt),
      },
      shrinkage: {
        k: 15,
        lambda: pct(r.lambda),
      },
    },
  }));

  const kimRows = byKimarite.get(key) || [];
  const kimByCourse = new Map();
  for (const r of kimRows) {
    const c = Number(r.course);
    const winN = Number(r.win_n || 0);
    const count = Number(r.kimarite_n || 0);
    const nationalRate = Number(r.national_rate || 0);
    const rawRate = winN > 0 ? 100 * count / winN : 0;
    const adjustedRate = 100 * (
      count + KIMARITE_COMPOSITION_ALPHA * (nationalRate / 100)
    ) / (winN + KIMARITE_COMPOSITION_ALPHA);
    const sufficient = winN >= KIMARITE_COMPOSITION_MIN_WINS;

    if (!kimByCourse.has(c)) {
      kimByCourse.set(c, {
        course: c,
        win_n: winN,
        sufficient,
        alpha: KIMARITE_COMPOSITION_ALPHA,
        minimum_wins_for_rate: KIMARITE_COMPOSITION_MIN_WINS,
        items: [],
      });
    }
    kimByCourse.get(c).items.push({
      kimarite: r.kimarite,
      count,
      raw_rate: pct(rawRate),
      adjusted_rate: pct(adjustedRate),
      national_same_course_rate: pct(nationalRate),
      diff_pt_raw: pct(rawRate - nationalRate),
      diff_pt_adjusted: pct(adjustedRate - nationalRate),
      notable: sufficient && Math.abs(adjustedRate - nationalRate) >= 15,
    });
  }

  const payload = {
    schema_version: 1,
    generated_at: generatedAt,
    data_period: period,
    racer: {
      regno,
      name,
      kana,
      kana_katakana,
      grade,
      branch,
    },
    totals: {
      n: Number(racer.total_starts),
      first_start_date: racer.first_start_date,
      last_start_date: racer.last_start_date,
    },
    course_stats: courses,
    win_kimarite_breakdown: [...kimByCourse.values()].sort((a, b) => a.course - b.course),
    venue_stats: venue,
    notes: {
      grade_branch_source: "wake_dictionary_racer_profile_v1 / BOATCAST_STR3",
      kana_source: "wake_dictionary_racer_kana_v1 / BOATRACE_OFFICIAL_PROFILE",
      kimarite_meaning: "breakdown_of_how_the_racer_won; not an attacking-style rate",
      kimarite_display_rule: "when sufficient=false (win_n<20), UI must hide rates and show counts only",
      kimarite_composition_alpha: KIMARITE_COMPOSITION_ALPHA,
      refund_races: "valid completed races are retained; F/L ST is excluded from avg ST",
    },
  };

  await writeJson(resolve(OUT_DIR, "racers", `${regno}.json`), payload);
}


// ============================================================================
// v1.4 差別化機能用: 級別基準値 / 逆引き / ランキングを事前計算
//
// 重要:
// - 決まり手の「率」は、勝利内構成比ではなく「そのコースの出走数に対する
//   その決まり手での1着率」を使用する。
// - 縮小推定 K=15。
// - 級別指定時の基準は「級別×コース」。
// - ALL指定時の基準は「全国×コース」。
// - UI側では既定の最低走数を30にするが、JSON自体は全件保持する。
// ============================================================================

const courseRowMap = new Map();
for (const r of courseStats) {
  courseRowMap.set(`${r.regno}|${r.course}`, r);
}

const kimRowsByCell = new Map();
for (const r of kimariteRows) {
  const key = `${r.regno}|${r.course}`;
  if (!kimRowsByCell.has(key)) kimRowsByCell.set(key, []);
  kimRowsByCell.get(key).push(r);
}

function gradeOf(regno) {
  return profileByRegno.get(String(regno))?.grade || null;
}
function branchOf(regno) {
  return profileByRegno.get(String(regno))?.branch || null;
}

// grade × course と ALL × course の基準値を作る。
const baselineAcc = new Map();
for (const scope of GRADE_SCOPES) {
  for (let course = 1; course <= 6; course++) {
    baselineAcc.set(`${scope}|${course}`, makeAccumulator());
  }
}

for (const racer of racers) {
  const regno = Number(racer.regno);
  const grade = gradeOf(regno);

  for (let course = 1; course <= 6; course++) {
    const row = courseRowMap.get(`${regno}|${course}`);
    if (!row) continue;
    const kim = kimRowsByCell.get(`${regno}|${course}`) || [];

    addCourseToAccumulator(baselineAcc.get(`ALL|${course}`), row, kim);
    if (GRADES.includes(grade)) {
      addCourseToAccumulator(baselineAcc.get(`${grade}|${course}`), row, kim);
    }
  }
}

const baselineJson = {
  schema_version: 1,
  generated_at: generatedAt,
  data_period: period,
  shrinkage_k: SHRINK_K,
  note: "grade-specific ranking baselines are grade×course; ALL uses national×course",
  grade_course: {},
};

for (const scope of GRADE_SCOPES) {
  baselineJson.grade_course[scope] = {};
  for (let course = 1; course <= 6; course++) {
    const a = baselineAcc.get(`${scope}|${course}`);
    const obj = {
      n: a.starts,
      win_rate: pct(ratePct(a.wins, a.starts)),
      ren2_rate: pct(ratePct(a.ren2, a.starts)),
      ren3_rate: pct(ratePct(a.ren3, a.starts)),
      avg_st: a.validStN ? st(a.stSum / a.validStN) : null,
      valid_st_n: a.validStN,
      f_count: a.fCount,
      l_count: a.lCount,
      kimarite_win_rate_per_start: {},
      kimarite_win_composition: {},
    };
    for (const kind of KIMARITE_KINDS) {
      obj.kimarite_win_rate_per_start[kind.name] = pct(
        ratePct(a.kimarite[kind.name], a.starts)
      );
      obj.kimarite_win_composition[kind.name] = a.wins > 0
        ? pct(ratePct(a.kimarite[kind.name], a.wins))
        : null;
    }
    baselineJson.grade_course[scope][String(course)] = obj;
  }
}

await writeJson(resolve(OUT_DIR, "meta", "baselines.json"), baselineJson);

// ----------------------------------------------------------------------------
// ★1 逆引き検索
// 6コース × 6決まり手 × (ALL + A1/A2/B1/B2)
// ----------------------------------------------------------------------------
const reverseCatalog = [];
let reverseFileCount = 0;

for (let course = 1; course <= 6; course++) {
  for (const kind of KIMARITE_KINDS) {
    for (const scope of GRADE_SCOPES) {
      const baselineRate =
        baselineJson.grade_course[scope][String(course)]
          .kimarite_win_rate_per_start[kind.name];

      const rows = [];

      for (const racer of racers) {
        const regno = Number(racer.regno);
        const grade = gradeOf(regno);
        if (scope !== "ALL" && grade !== scope) continue;

        const courseRow = courseRowMap.get(`${regno}|${course}`);
        if (!courseRow) continue;

        const starts = Number(courseRow.n || 0);
        const kimRow = (kimRowsByCell.get(`${regno}|${course}`) || [])
          .find((x) => x.kimarite === kind.name);
        const count = Number(kimRow?.kimarite_n || 0);

        const rawRate = ratePct(count, starts);
        const adjRate = shrinkRatePct(count, starts, baselineRate);

        rows.push({
          regno,
          name: racer.racer_name || "",
          grade,
          branch: branchOf(regno),
          course,
          kimarite: kind.name,
          n: starts,
          count,
          rawRate: pct(rawRate),
          adjRate: pct(adjRate),
          baselineRate: pct(baselineRate),
          diffPtAdjusted: pct(adjRate - baselineRate),
          shrinkageK: SHRINK_K,
        });
      }

      rows.sort(sortDescAdjusted);

      const filename =
        `reverse_course${course}_${kind.slug}_${scope}.json`;

      await writeJson(
        resolve(OUT_DIR, "index", filename),
        {
          schema_version: 1,
          generated_at: generatedAt,
          data_period: period,
          course,
          kimarite: kind.name,
          grade: scope,
          default_min_n: 30,
          sort: "adjRate_desc",
          rows,
        }
      );

      reverseCatalog.push({
        file: filename,
        course,
        kimarite: kind.name,
        kimarite_slug: kind.slug,
        grade: scope,
        rows: rows.length,
      });
      reverseFileCount++;
    }
  }
}

await writeJson(
  resolve(OUT_DIR, "index", "reverse_catalog.json"),
  {
    schema_version: 1,
    generated_at: generatedAt,
    default_min_n: 30,
    files: reverseCatalog,
  }
);

// ----------------------------------------------------------------------------
// ★2 級別×決まり手ランキング
// ----------------------------------------------------------------------------
function aggregateRacer(regno, coursesWanted) {
  const acc = makeAccumulator();
  for (const course of coursesWanted) {
    const row = courseRowMap.get(`${regno}|${course}`);
    if (!row) continue;
    addCourseToAccumulator(
      acc,
      row,
      kimRowsByCell.get(`${regno}|${course}`) || []
    );
  }
  return acc;
}

function weightedBaselinePct(scope, coursesWanted, metric, racerRegno) {
  let weighted = 0;
  let totalN = 0;
  for (const course of coursesWanted) {
    const row = courseRowMap.get(`${racerRegno}|${course}`);
    const starts = Number(row?.n || 0);
    if (!starts) continue;
    const b = baselineJson.grade_course[scope]?.[String(course)];
    if (!b) continue;
    const value = Number(b[metric]);
    if (!Number.isFinite(value)) continue;
    weighted += starts * value;
    totalN += starts;
  }
  return totalN ? weighted / totalN : null;
}

function weightedKimariteBaselinePct(scope, coursesWanted, kimarite, racerRegno) {
  let weighted = 0;
  let totalN = 0;
  for (const course of coursesWanted) {
    const row = courseRowMap.get(`${racerRegno}|${course}`);
    const starts = Number(row?.n || 0);
    if (!starts) continue;
    const b =
      baselineJson.grade_course[scope]?.[String(course)]
        ?.kimarite_win_rate_per_start?.[kimarite];
    if (b == null) continue;
    weighted += starts * Number(b);
    totalN += starts;
  }
  return totalN ? weighted / totalN : null;
}

function weightedStBaseline(scope, coursesWanted, racerRegno) {
  let sum = 0;
  let totalValid = 0;
  for (const course of coursesWanted) {
    const row = courseRowMap.get(`${racerRegno}|${course}`);
    if (!row) continue;
    const starts = Number(row.n || 0);
    const validN = Math.max(
      0,
      starts -
        Number(row.f_count || 0) -
        Number(row.l_count || 0) -
        Number(row.st_missing_count || 0)
    );
    const b = baselineJson.grade_course[scope]?.[String(course)]?.avg_st;
    if (!validN || b == null) continue;
    sum += validN * Number(b);
    totalValid += validN;
  }
  return totalValid ? sum / totalValid : null;
}

function baseEntry(racer, acc) {
  const regno = Number(racer.regno);
  return {
    regno,
    name: racer.racer_name || "",
    grade: gradeOf(regno),
    branch: branchOf(regno),
    n: acc.starts,
  };
}

const rankingCatalog = [];

async function writeRanking(filename, title, rows, sort, extra = {}) {
  await writeJson(
    resolve(OUT_DIR, "index", filename),
    {
      schema_version: 1,
      generated_at: generatedAt,
      data_period: period,
      title,
      default_min_n: 30,
      shrinkage_k: SHRINK_K,
      sort,
      ...extra,
      rows,
    }
  );
  rankingCatalog.push({ file: filename, title, rows: rows.length, sort });
}

// B級の伏兵: B1/B2、3〜6コース1着率が本人級別基準より高い順。
{
  const rows = [];
  for (const racer of racers) {
    const regno = Number(racer.regno);
    const grade = gradeOf(regno);
    if (!["B1", "B2"].includes(grade)) continue;

    const coursesWanted = [3,4,5,6];
    const a = aggregateRacer(regno, coursesWanted);
    if (!a.starts) continue;

    const baselineRate = weightedBaselinePct(
      grade, coursesWanted, "win_rate", regno
    );
    if (baselineRate == null) continue;

    const rawRate = ratePct(a.wins, a.starts);
    const adjRate = shrinkRatePct(a.wins, a.starts, baselineRate);

    rows.push({
      ...baseEntry(racer, a),
      courses: coursesWanted,
      wins: a.wins,
      rawRate: pct(rawRate),
      adjRate: pct(adjRate),
      baselineRate: pct(baselineRate),
      diffPtAdjusted: pct(adjRate - baselineRate),
    });
  }
  rows.sort((a,b) =>
    Number(b.diffPtAdjusted) - Number(a.diffPtAdjusted) ||
    Number(b.adjRate) - Number(a.adjRate) ||
    Number(b.n) - Number(a.n)
  );
  await writeRanking(
    "ranking_b_attackers.json",
    "B級の伏兵",
    rows,
    "diffPtAdjusted_desc",
    { grades: ["B1","B2"], courses: [3,4,5,6], metric: "win_rate" }
  );
}

// 級別ごとの主要ランキング。
for (const grade of GRADES) {
  const gradeRacers = racers.filter((r) => gradeOf(Number(r.regno)) === grade);

  // まくり職人 / 差し名人
  for (const kind of [
    { name: "まくり", slug: "makuri", title: "まくり職人" },
    { name: "差し", slug: "sashi", title: "差し名人" },
  ]) {
    const rows = [];
    for (const racer of gradeRacers) {
      const regno = Number(racer.regno);
      const coursesWanted = [1,2,3,4,5,6];
      const a = aggregateRacer(regno, coursesWanted);
      if (!a.starts) continue;

      const count = a.kimarite[kind.name];
      const baselineRate = weightedKimariteBaselinePct(
        grade, coursesWanted, kind.name, regno
      );
      if (baselineRate == null) continue;

      const rawRate = ratePct(count, a.starts);
      const adjRate = shrinkRatePct(count, a.starts, baselineRate);

      rows.push({
        ...baseEntry(racer, a),
        count,
        kimarite: kind.name,
        rawRate: pct(rawRate),
        adjRate: pct(adjRate),
        baselineRate: pct(baselineRate),
        diffPtAdjusted: pct(adjRate - baselineRate),
      });
    }
    rows.sort(sortDescAdjusted);
    await writeRanking(
      `ranking_${kind.slug}_${grade}.json`,
      `${grade} ${kind.title}`,
      rows,
      "adjRate_desc",
      { grade, kimarite: kind.name, metric: "kimarite_win_rate_per_start" }
    );
  }

  // イン最強 / イン不安定 = 1コース逃げ率
  {
    const strong = [];
    for (const racer of gradeRacers) {
      const regno = Number(racer.regno);
      const a = aggregateRacer(regno, [1]);
      if (!a.starts) continue;

      const count = a.kimarite["逃げ"];
      const baselineRate =
        baselineJson.grade_course[grade]["1"]
          .kimarite_win_rate_per_start["逃げ"];

      const rawRate = ratePct(count, a.starts);
      const adjRate = shrinkRatePct(count, a.starts, baselineRate);

      strong.push({
        ...baseEntry(racer, a),
        count,
        course: 1,
        kimarite: "逃げ",
        rawRate: pct(rawRate),
        adjRate: pct(adjRate),
        baselineRate: pct(baselineRate),
        diffPtAdjusted: pct(adjRate - baselineRate),
      });
    }

    const unstable = strong.map((x) => ({...x}));
    strong.sort(sortDescAdjusted);
    unstable.sort(sortAscAdjusted);

    await writeRanking(
      `ranking_in_strong_${grade}.json`,
      `${grade} イン最強`,
      strong,
      "adjRate_desc",
      { grade, course: 1, metric: "nige_win_rate_per_start" }
    );
    await writeRanking(
      `ranking_in_unstable_${grade}.json`,
      `${grade} イン不安定`,
      unstable,
      "adjRate_asc",
      { grade, course: 1, metric: "nige_win_rate_per_start", default_min_n: 50 }
    );
  }

  // ダッシュ巧者 = 4〜6コース3連対率
  {
    const rows = [];
    for (const racer of gradeRacers) {
      const regno = Number(racer.regno);
      const coursesWanted = [4,5,6];
      const a = aggregateRacer(regno, coursesWanted);
      if (!a.starts) continue;

      const baselineRate = weightedBaselinePct(
        grade, coursesWanted, "ren3_rate", regno
      );
      if (baselineRate == null) continue;

      const rawRate = ratePct(a.ren3, a.starts);
      const adjRate = shrinkRatePct(a.ren3, a.starts, baselineRate);

      rows.push({
        ...baseEntry(racer, a),
        courses: coursesWanted,
        ren3: a.ren3,
        rawRate: pct(rawRate),
        adjRate: pct(adjRate),
        baselineRate: pct(baselineRate),
        diffPtAdjusted: pct(adjRate - baselineRate),
      });
    }
    rows.sort(sortDescAdjusted);
    await writeRanking(
      `ranking_dash_${grade}.json`,
      `${grade} ダッシュ巧者`,
      rows,
      "adjRate_desc",
      { grade, courses: [4,5,6], metric: "ren3_rate" }
    );
  }

  // スタート巧者 = Fなし版 + 全員版
  {
    const allRows = [];
    for (const racer of gradeRacers) {
      const regno = Number(racer.regno);
      const coursesWanted = [1,2,3,4,5,6];
      const a = aggregateRacer(regno, coursesWanted);
      if (!a.validStN) continue;

      const baselineMean = weightedStBaseline(grade, coursesWanted, regno);
      if (baselineMean == null) continue;

      const rawSt = a.stSum / a.validStN;
      const adjustedSt = shrinkMean(
        a.stSum, a.validStN, baselineMean, SHRINK_K
      );

      allRows.push({
        ...baseEntry(racer, a),
        n: a.validStN,
        total_starts: a.starts,
        avgSt: st(rawSt),
        adjustedSt: st(adjustedSt),
        baselineAvgSt: st(baselineMean),
        diffAdjusted: st(adjustedSt - baselineMean),
        f_count: a.fCount,
        l_count: a.lCount,
      });
    }

    allRows.sort((a,b) =>
      Number(a.adjustedSt) - Number(b.adjustedSt) ||
      Number(a.avgSt) - Number(b.avgSt) ||
      Number(b.n) - Number(a.n)
    );

    const noF = allRows.filter((x) => Number(x.f_count) === 0);

    await writeRanking(
      `ranking_start_${grade}.json`,
      `${grade} スタート巧者`,
      allRows,
      "adjustedSt_asc",
      { grade, metric: "avg_st", f_filter: "all" }
    );
    await writeRanking(
      `ranking_start_no_f_${grade}.json`,
      `${grade} スタート巧者（Fなし）`,
      noF,
      "adjustedSt_asc",
      { grade, metric: "avg_st", f_filter: "f_count_zero" }
    );
  }
}


// ----------------------------------------------------------------------------
// ★3 「この選手の意外な一面」 + ★4 まくられ耐性 / 差され耐性
// ----------------------------------------------------------------------------

function courseValidStN(row) {
  if (!row) return 0;
  return Math.max(
    0,
    Number(row.n || 0)
      - Number(row.f_count || 0)
      - Number(row.l_count || 0)
      - Number(row.st_missing_count || 0)
  );
}

function strongestPerType(candidates) {
  const best = new Map();
  for (const c of candidates) {
    const old = best.get(c.type);
    if (!old || Number(c.strength_ratio) > Number(old.strength_ratio)) {
      best.set(c.type, c);
    }
  }
  return [...best.values()]
    .sort((a,b) =>
      Number(b.strength_ratio) - Number(a.strength_ratio) ||
      String(a.type).localeCompare(String(b.type))
    )
    .slice(0, 3);
}

function buildInsightsForRacer(regno) {
  const grade = gradeOf(regno);
  const scope = GRADES.includes(grade) ? grade : "ALL";
  const candidates = [];

  // (1) コース別1着率: 級別×コース基準との差 ±8pt、n>=30
  for (let course = 1; course <= 6; course++) {
    const row = courseRowMap.get(`${regno}|${course}`);
    if (!row || Number(row.n || 0) < 30) continue;

    const baselineRate =
      baselineJson.grade_course?.[scope]?.[String(course)]?.win_rate;
    if (baselineRate == null) continue;

    const adjustedRate = shrinkRatePct(
      Number(row.win_n || 0),
      Number(row.n || 0),
      Number(baselineRate),
      SHRINK_K
    );
    const diff = adjustedRate - Number(baselineRate);

    if (Math.abs(diff) >= 8) {
      candidates.push({
        type: "course_win",
        direction: diff > 0 ? "strong" : "weak",
        course,
        n: Number(row.n),
        adjusted_rate: pct(adjustedRate),
        baseline_rate: pct(baselineRate),
        diff_pt: pct(diff),
        baseline_scope: scope,
        strength_ratio: pct(Math.abs(diff) / 8),
      });
    }
  }

  // (2) 決まり手偏重: 級別×コース基準より +20pt、勝利数>=20
  for (let course = 1; course <= 6; course++) {
    const row = courseRowMap.get(`${regno}|${course}`);
    if (!row) continue;
    const winN = Number(row.win_n || 0);
    if (winN < 20) continue;

    for (const kind of KIMARITE_KINDS) {
      const baselineComp =
        baselineJson.grade_course?.[scope]?.[String(course)]
          ?.kimarite_win_composition?.[kind.name];
      if (baselineComp == null) continue;

      const kimRow = (kimRowsByCell.get(`${regno}|${course}`) || [])
        .find((x) => x.kimarite === kind.name);
      const count = Number(kimRow?.kimarite_n || 0);

      const adjustedComp = 100 * (
        count + KIMARITE_COMPOSITION_ALPHA * (Number(baselineComp) / 100)
      ) / (winN + KIMARITE_COMPOSITION_ALPHA);
      const diff = adjustedComp - Number(baselineComp);

      if (diff >= 20) {
        candidates.push({
          type: "kimarite_bias",
          course,
          kimarite: kind.name,
          win_n: winN,
          count,
          adjusted_rate: pct(adjustedComp),
          baseline_rate: pct(baselineComp),
          diff_pt: pct(diff),
          baseline_scope: scope,
          strength_ratio: pct(diff / 20),
        });
      }
    }
  }

  // (3) ST特性: コース平均を本人全体STへK=15で縮小し、
  //     本人平均より0.02以上速い、n>=30
  const courseRows = [];
  let personalStSum = 0;
  let personalStN = 0;
  for (let course = 1; course <= 6; course++) {
    const row = courseRowMap.get(`${regno}|${course}`);
    if (!row) continue;
    courseRows.push(row);
    const validN = courseValidStN(row);
    const avg = n(row.avg_st);
    if (validN > 0 && avg != null) {
      personalStSum += avg * validN;
      personalStN += validN;
    }
  }
  const personalAvgSt = personalStN > 0 ? personalStSum / personalStN : null;

  if (personalAvgSt != null) {
    for (const row of courseRows) {
      const starts = Number(row.n || 0);
      const validN = courseValidStN(row);
      const rawAvg = n(row.avg_st);
      if (starts < 30 || validN <= 0 || rawAvg == null) continue;

      const adjustedAvg = shrinkMean(
        rawAvg * validN,
        validN,
        personalAvgSt,
        SHRINK_K
      );
      const diff = adjustedAvg - personalAvgSt;

      if (diff <= -0.02) {
        candidates.push({
          type: "st_fast",
          course: Number(row.course),
          n: starts,
          valid_st_n: validN,
          adjusted_st: st(adjustedAvg),
          personal_avg_st: st(personalAvgSt),
          diff: st(diff),
          strength_ratio: pct(Math.abs(diff) / 0.02),
        });
      }
    }
  }

  // (4) 場別3連対率: 本人全場基準との差 ±10pt、n>=20
  for (const row of byVenue.get(String(regno)) || []) {
    if (Number(row.n || 0) < 20) continue;
    const diff = Number(row.adjusted_ren3_diff_pt);
    if (!Number.isFinite(diff) || Math.abs(diff) < 10) continue;

    candidates.push({
      type: "venue_ren3",
      direction: diff > 0 ? "strong" : "weak",
      place_no: Number(row.place_no),
      n: Number(row.n),
      adjusted_rate: pct(row.adjusted_ren3_rate),
      baseline_rate: pct(row.personal_all_venue_ren3_rate),
      diff_pt: pct(diff),
      strength_ratio: pct(Math.abs(diff) / 10),
    });
  }

  return strongestPerType(candidates);
}

function defensePayload(regno) {
  const rows = byDefense.get(String(regno)) || [];
  const out = {
    period: {
      start: rows[0]?.period_start || null,
      end: rows[0]?.period_end || null,
    },
    minimum_events: 8,
    baseline_method: "national_average_weighted_to_the_racers_victim_course_mix",
    makurare: null,
    sasare: null,
  };

  for (const r of rows) {
    const item = {
      n: Number(r.n),
      avg_finish: pct(r.avg_finish),
      top3_n: Number(r.top3_n),
      top3_rate: pct(r.top3_rate),
      baseline_avg_finish: pct(r.baseline_avg_finish),
      baseline_top3_rate: pct(r.baseline_top3_rate),
      avg_finish_diff: pct(r.avg_finish_diff),
      top3_diff_pt: pct(r.top3_diff_pt),
      sufficient: Boolean(r.sufficient),
    };
    if (r.defense_type === "まくられ") out.makurare = item;
    if (r.defense_type === "差され") out.sasare = item;
  }

  return out;
}

await mkdir(resolve(OUT_DIR, "features"), { recursive: true });

let insightNoneCount = 0;
for (const racer of racers) {
  const regno = Number(racer.regno);
  const insights = buildInsightsForRacer(regno);
  if (!insights.length) insightNoneCount++;

  await writeJson(
    resolve(OUT_DIR, "features", `${regno}.json`),
    {
      schema_version: 1,
      generated_at: generatedAt,
      data_period: period,
      insights: {
        max_items: 3,
        selection_rule: "strongest_one_per_category_then_threshold_ratio_desc",
        items: insights,
        empty_message: insights.length ? null : "特筆すべき偏りなし",
        note: "insight detection always uses shrinkage-adjusted values to avoid low-sample false positives",
      },
      defense_1y: defensePayload(regno),
    }
  );
}

console.log(`feature_files=${racers.length}`);
console.log(`insight_none_racers=${insightNoneCount}`);
console.log(`defense_rows=${defenseRows.length}`);


await writeJson(
  resolve(OUT_DIR, "index", "ranking_catalog.json"),
  {
    schema_version: 1,
    generated_at: generatedAt,
    default_min_n: 30,
    files: rankingCatalog,
  }
);

console.log(`reverse_index_files=${reverseFileCount}`);
console.log(`ranking_files=${rankingCatalog.length}`);

await writeJson(resolve(OUT_DIR, "index.json"), index);
await writeJson(resolve(OUT_DIR, "metadata.json"), {
  schema_version: 1,
  generated_at: generatedAt,
  data_period: period,
  source_quality: {
    raw_rows: Number(md.raw_rows),
    raw_races: Number(md.raw_races),
    usable_start_rows: Number(md.usable_start_rows),
    usable_races: Number(md.usable_races),
    racers: Number(md.racers),
    f_starts: Number(md.f_starts),
    l_starts: Number(md.l_starts),
    other_st_missing_rows: Number(md.other_st_missing_rows),
    staging_coverage_pct: pct(md.staging_coverage_pct),
    no_winner_races: Number(md.no_winner_races),
    winner_status_unknown_races: Number(md.winner_status_unknown_races),
    winner_status_false_races: Number(md.winner_status_false_races),
    excluded_flag_races: Number(md.excluded_flag_races),
    refund_related_races: Number(md.refund_related_races),
    grade_available: racerProfiles.some((r) => /^(A1|A2|B1|B2)$/.test(String(r.grade || ""))),
    branch_available: racerProfiles.some((r) => String(r.branch || "").trim()),
    grade_profile_count: racerProfiles.filter((r) => /^(A1|A2|B1|B2)$/.test(String(r.grade || ""))).length,
    branch_profile_count: racerProfiles.filter((r) => String(r.branch || "").trim()).length,
    kana_profile_count: racerKanaRows.filter((r) => String(r.kana_hiragana || "").trim()).length,
    kana_coverage_pct: racers.length
      ? Math.round(
          100000 * racerKanaRows.filter((r) => String(r.kana_hiragana || "").trim()).length
          / racers.length
        ) / 1000
      : 0,
    grade_profile_coverage_pct: pct(
      100 * racerProfiles.filter((r) => /^(A1|A2|B1|B2)$/.test(String(r.grade || ""))).length
      / Math.max(racers.length, 1)
    ),
  },
});

const indexBytes = Buffer.byteLength(compactJson(index), "utf8");
console.log(`course_rows=${courseStats.length}`);
console.log(`venue_rows=${venueStats.length}`);
console.log(`kimarite_rows=${kimariteRows.length}`);
console.log(`defense_rows=${defenseRows.length}`);
console.log(`index_bytes=${indexBytes}`);
if (indexBytes > 500_000) {
  throw new Error(`index.json too large: ${indexBytes} bytes`);
}
if (indexBytes > 300_000) {
  console.warn(`WARNING: index.json exceeds 300KB (${indexBytes} bytes)`);
}
console.log("WAKE dictionary export complete");
