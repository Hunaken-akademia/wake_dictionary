#!/usr/bin/env node
/**
 * BOAT RACE女子レーサー名鑑から現役女子選手を取得する。
 *
 * 取得成功時は data/women_racers.json を更新する。
 * 一時障害時はコミット済みの直近正常ファイルを使い続けるため、
 * 女子フィルターだけを理由に日次デプロイを停止しない。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUT_FILE = resolve(
  process.env.WAKE_WOMEN_RACERS_FILE || "data/women_racers.json"
);
const API = "https://www.ladies-info.jp/api-racers/api";
const MIN_EXPECTED = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          accept: "application/json,text/plain,*/*",
          "user-agent": "Mozilla/5.0 WAKE-Dictionary/2.5",
          referer: "https://www.ladies-info.jp/list/",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("fetch failed");
}

async function existingPayload() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  try {
    const first = await fetchJson(`${API}?page=1&sort=no&order=asc`);
    const maxPage = Math.max(1, Number(first.max_page || 1));
    const all = [...(first.racers || [])];

    const pages = Array.from({length:Math.max(0,maxPage-1)},(_,i)=>i+2);
    for (let i = 0; i < pages.length; i += 4) {
      const batch = await Promise.all(
        pages.slice(i,i+4).map((page) =>
          fetchJson(`${API}?page=${page}&sort=no&order=asc`)
        )
      );
      for (const data of batch) all.push(...(data.racers || []));
    }

    const racers = [...new Map(
      all
        .map((r) => ({
          regno: Number(r.no),
          name: String(r.name || "").trim(),
        }))
        .filter((r) => Number.isInteger(r.regno) && r.regno > 0)
        .map((r) => [r.regno, r])
    ).values()].sort((a, b) => a.regno - b.regno);

    if (racers.length < MIN_EXPECTED) {
      throw new Error(`women racer count too small: ${racers.length}`);
    }

    const payload = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source: "BOAT_RACE_LADIES_INFO",
      count: racers.length,
      racers,
    };
    await mkdir(dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(`women_racer_count=${racers.length}`);
    console.log(`women_racer_source=live`);
  } catch (error) {
    const old = await existingPayload();
    const count = Array.isArray(old?.racers) ? old.racers.length : 0;
    if (count < MIN_EXPECTED) throw error;
    console.warn(`women racer refresh unavailable: ${error.message || error}`);
    console.log(`women_racer_count=${count}`);
    console.log(`women_racer_source=fallback`);
  }
}

await main();
