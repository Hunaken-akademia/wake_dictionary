#!/usr/bin/env node
/**
 * WAKE辞典 v1.9 公式プロフィール読み仮名コレクタ
 *
 * URL:
 * https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban={regno}
 *
 * 取得:
 * - 登録番号
 * - 漢字氏名
 * - 公式プロフィールに表示されるカナ
 *
 * 永続化:
 * public.wake_dictionary_racer_kana_v1
 *
 * 方針:
 * - 既存kanaがあり、氏名も同じなら再取得しない
 * - 初回だけ未取得選手を取得
 * - 以後は新規/未取得/氏名変更のみ
 * - HTMLのclass名を決め打ちせず、氏名直後のカナ行を抽出
 */

const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_URL = RAW_SUPABASE_URL
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || "");
const CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.RACER_KANA_CONCURRENCY || 6))
);

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are required");
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function fetchAll(resource, { select = "*", order = "" } = {}) {
  const out = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const qs = new URLSearchParams({
      select,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (order) qs.set("order", order);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${qs}`, {
      headers,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${resource} ${res.status}: ${text.slice(0, 1000)}`);
    }
    const rows = text ? JSON.parse(text) : [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function upsertRows(rows) {
  if (!rows.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/wake_dictionary_racer_kana_v1?on_conflict=regno`,
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
  if (!res.ok) {
    throw new Error(`kana upsert ${res.status}: ${text.slice(0, 1000)}`);
  }
}

function profileUrl(regno) {
  return `https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=${encodeURIComponent(regno)}`;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeName(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "");
}

function normalizeKatakana(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[・･]/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/[^\u30A0-\u30FFー]/g, "");
}

function katakanaToHiragana(s) {
  return [...String(s || "")].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp >= 0x30A1 && cp <= 0x30F6) {
      return String.fromCodePoint(cp - 0x60);
    }
    return ch;
  }).join("");
}

function htmlToLines(html) {
  const cleaned = decodeEntities(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
      .replace(/<(?:br|\/p|\/div|\/li|\/dd|\/dt|\/h\d|\/tr|\/td)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );

  return cleaned
    .split(/\n+/)
    .map((x) => x.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

function isKanaLine(s) {
  const compact = normalizeKatakana(s);
  if (compact.length < 3 || compact.length > 30) return false;
  const stripped = String(s || "")
    .normalize("NFKC")
    .replace(/[・･\s　]+/g, "");
  return /^[ァ-ヶー]+$/.test(stripped);
}

function extractKana(html, expectedName) {
  const lines = htmlToLines(html);
  const expected = normalizeName(expectedName);

  // Official profile renders the reading directly under the racer name.
  for (let i = 0; i < lines.length; i++) {
    if (normalizeName(lines[i]) !== expected) continue;

    for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j++) {
      if (!isKanaLine(lines[j])) continue;
      const katakana = normalizeKatakana(lines[j]);
      return {
        katakana,
        hiragana: katakanaToHiragana(katakana),
        matched_line: lines[j],
      };
    }
  }

  // Fallback: search a short text window immediately after the exact name.
  const text = lines.join("\n");
  const idx = text.indexOf(expectedName);
  if (idx >= 0) {
    const window = text.slice(idx + expectedName.length, idx + expectedName.length + 300);
    const m = window.match(/(?:^|\n)\s*([ァ-ヶー]{1,15}(?:[\s　]+[ァ-ヶー]{1,15})+)\s*(?:\n|$)/);
    if (m) {
      const katakana = normalizeKatakana(m[1]);
      if (katakana.length >= 3) {
        return {
          katakana,
          hiragana: katakanaToHiragana(katakana),
          matched_line: m[1],
        };
      }
    }
  }

  return null;
}

async function fetchProfile(regno, expectedName) {
  const url = profileUrl(regno);
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 WAKE-Dictionary/1.9",
          accept: "text/html,application/xhtml+xml",
        },
      });
      const html = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const parsed = extractKana(html, expectedName);
      if (!parsed) {
        throw new Error("kana not found near racer name");
      }

      return {
        regno: Number(regno),
        racer_name: expectedName || null,
        kana_katakana: parsed.katakana,
        kana_hiragana: parsed.hiragana,
        source: "BOATRACE_OFFICIAL_PROFILE",
        source_url: url,
        captured_at: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 800));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

const racers = await fetchAll(
  "wake_dictionary_racers_v1",
  { select: "regno,racer_name", order: "regno.asc" }
);

let existing = [];
try {
  existing = await fetchAll(
    "wake_dictionary_racer_kana_v1",
    { select: "regno,racer_name,kana_katakana,kana_hiragana", order: "regno.asc" }
  );
} catch (error) {
  throw new Error(
    `wake_dictionary_racer_kana_v1 is not ready. Run sql/07_racer_kana.sql first. ${error.message || error}`
  );
}

const existingByRegno = new Map(
  existing.map((r) => [Number(r.regno), r])
);

const targets = racers.filter((r) => {
  const old = existingByRegno.get(Number(r.regno));
  if (!old?.kana_hiragana || !old?.kana_katakana) return true;
  return normalizeName(old.racer_name) !== normalizeName(r.racer_name);
});

console.log(`racer_total=${racers.length}`);
console.log(`kana_existing=${existing.length}`);
console.log(`kana_to_fetch=${targets.length}`);
console.log(`concurrency=${CONCURRENCY}`);

let cursor = 0;
let ok = 0;
let failed = 0;
const failedRows = [];
const buffer = [];

async function flush() {
  if (!buffer.length) return;
  const rows = buffer.splice(0, buffer.length);
  await upsertRows(rows);
}

async function worker(workerId) {
  while (true) {
    const i = cursor++;
    if (i >= targets.length) return;

    const racer = targets[i];
    try {
      const row = await fetchProfile(racer.regno, racer.racer_name);
      buffer.push(row);
      ok++;

      if (buffer.length >= 50) {
        await flush();
      }
    } catch (error) {
      failed++;
      failedRows.push({
        regno: racer.regno,
        name: racer.racer_name,
        error: String(error?.message || error),
      });
    }

    const done = ok + failed;
    if (done % 50 === 0 || done === targets.length) {
      console.log(
        `kana fetch ${done}/${targets.length} ok=${ok} failed=${failed}`
      );
    }
  }
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1))
);
await flush();

const finalRows = await fetchAll(
  "wake_dictionary_racer_kana_v1",
  { select: "regno,kana_hiragana,kana_katakana", order: "regno.asc" }
);

const valid = finalRows.filter(
  (r) => String(r.kana_hiragana || "").trim() && String(r.kana_katakana || "").trim()
);

console.log(`kana_profile_total=${finalRows.length}`);
console.log(`kana_valid_total=${valid.length}`);
console.log(
  `kana_coverage_pct=${racers.length ? (100 * valid.length / racers.length).toFixed(2) : "0.00"}`
);

if (failedRows.length) {
  console.log(`kana_failed_samples=${JSON.stringify(failedRows.slice(0, 10))}`);
}

// Do not fail for a tiny number of inaccessible legacy profiles.
// But zero/very low coverage means parser/source failure and must stop deployment.
if (valid.length < Math.max(1000, Math.floor(racers.length * 0.90))) {
  throw new Error(
    `kana coverage too low: ${valid.length}/${racers.length}. Stop before export.`
  );
}
