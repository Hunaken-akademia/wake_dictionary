#!/usr/bin/env node
/**
 * WAKE辞典 JSON exporter v1.2.4
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
const RACER_BATCH_SIZE = 25;

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

console.log("WAKE dictionary export start");
console.log(`out=${OUT_DIR}`);
console.log(`racer_batch_size=${RACER_BATCH_SIZE}`);

// 軽いVIEWを先に取得し、regno一覧を確定する。
const [metadataRows, racers] = await Promise.all([
  fetchAll("wake_dictionary_metadata_v1"),
  fetchAll("wake_dictionary_racers_v1", { order: "regno.asc" }),
]);

if (metadataRows.length !== 1) {
  throw new Error(`wake_dictionary_metadata_v1 expected 1 row, got ${metadataRows.length}`);
}

console.log(`racers=${racers.length}`);

// 重い集計VIEWは同時実行しない。
// Supabaseのstatement timeoutを避けるため、順番に取得する。
// さらに各バッチで57014が出た場合は、そのバッチだけ自動で半分ずつ再分割する。
console.log("fetch course stats...");
const courseStats = await fetchByRacerBatches(
  "wake_dictionary_course_stats_v1",
  racers,
  {
    order: "regno.asc,course.asc",
    batchSize: 25,
  }
);

console.log("fetch venue stats...");
const venueStats = await fetchByRacerBatches(
  "wake_dictionary_venue_stats_v1",
  racers,
  {
    order: "regno.asc,place_no.asc",
    batchSize: 25,
  }
);

console.log("fetch kimarite stats...");
const kimariteRows = await fetchByRacerBatches(
  "wake_dictionary_win_kimarite_v1",
  racers,
  {
    order: "regno.asc,course.asc,kimarite.asc",
    // このVIEWが最も重いため初期値を小さくする。
    // それでもtimeoutしたバッチは5→3+2→...のように自動分割される。
    batchSize: 5,
  }
);

const md = metadataRows[0];
const generatedAt = new Date().toISOString();

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(resolve(OUT_DIR, "racers"), { recursive: true });

const byCourse = groupBy(courseStats, "regno");
const byVenue = groupBy(venueStats, "regno");
const byKimarite = groupBy(kimariteRows, "regno");

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

  index.push({
    regno,
    name,
    grade: racer.grade ?? null,
    branch: racer.branch ?? null,
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
    if (!kimByCourse.has(c)) {
      kimByCourse.set(c, {
        course: c,
        win_n: Number(r.win_n),
        sufficient: Boolean(r.sufficient),
        alpha: 10,
        items: [],
      });
    }
    kimByCourse.get(c).items.push({
      kimarite: r.kimarite,
      count: Number(r.kimarite_n),
      raw_rate: pct(r.raw_rate),
      adjusted_rate: pct(r.adjusted_rate),
      national_same_course_rate: pct(r.national_rate),
      diff_pt_raw: pct(r.raw_diff_pt),
      diff_pt_adjusted: pct(r.adjusted_diff_pt),
      notable: Boolean(r.notable),
    });
  }

  const payload = {
    schema_version: 1,
    generated_at: generatedAt,
    data_period: period,
    racer: {
      regno,
      name,
      grade: racer.grade ?? null,
      branch: racer.branch ?? null,
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
      grade_branch_source: "unavailable_in_audited_schema",
      kimarite_meaning: "breakdown_of_how_the_racer_won; not an attacking-style rate",
      kimarite_display_rule: "when sufficient=false (win_n<5), UI must hide rates and show counts only",
      refund_races: "valid completed races are retained; F/L ST is excluded from avg ST",
    },
  };

  await writeJson(resolve(OUT_DIR, "racers", `${regno}.json`), payload);
}

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
    grade_available: Boolean(md.grade_available),
    branch_available: Boolean(md.branch_available),
  },
});

const indexBytes = Buffer.byteLength(compactJson(index), "utf8");
console.log(`course_rows=${courseStats.length}`);
console.log(`venue_rows=${venueStats.length}`);
console.log(`kimarite_rows=${kimariteRows.length}`);
console.log(`index_bytes=${indexBytes}`);
if (indexBytes > 500_000) {
  throw new Error(`index.json too large: ${indexBytes} bytes`);
}
if (indexBytes > 300_000) {
  console.warn(`WARNING: index.json exceeds 300KB (${indexBytes} bytes)`);
}
console.log("WAKE dictionary export complete");
