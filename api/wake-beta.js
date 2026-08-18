import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticatedGoogleUser, isDictionaryAdmin } from "../lib/google-access.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "private-data");
const PLACE_NAMES = [null,"桐生","戸田","江戸川","平和島","多摩川","浜名湖","蒲郡","常滑","津","三国","びわこ","住之江","尼崎","鳴門","丸亀","児島","宮島","徳山","下関","若松","芦屋","福岡","唐津","大村"];
const ALLOWED_ORIGINS = new Set([
  "https://hunaken-akademia-v64.vercel.app",
  "https://wake-dictionary.vercel.app",
]);

async function json(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

function pct(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function featureTitles(value) {
  const out = [];
  const visit = (node) => {
    if (!node || out.length >= 2) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object") return;
    const label = node.title || node.label || node.name;
    if (typeof label === "string" && label.length <= 18 && !out.includes(label)) out.push(label === "イン不安定" ? "イン不" : label);
    Object.values(node).forEach(visit);
  };
  visit(value);
  return out.slice(0, 2);
}

export default async function handler(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin) || /^https:\/\/hunaken-akademia-v64-[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const user = await authenticatedGoogleUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!isDictionaryAdmin(user)) return res.status(403).json({ error: "admin_only" });

  const date = String(req.query?.date || "");
  const venue = String(req.query?.venue || "");
  const raceNo = Number(req.query?.race || 0);
  const placeNo = PLACE_NAMES.indexOf(venue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || placeNo < 1 || raceNo < 1 || raceNo > 12) {
    return res.status(400).json({ error: "invalid_race" });
  }

  try {
    const [today, venueData] = await Promise.all([
      json("today_entries.json"),
      json(`index/venue_${String(placeNo).padStart(2, "0")}.json`),
    ]);
    if (String(today.date || "") !== date) return res.status(200).json({ race: null, reason: "date_not_available" });

    const venueByRegno = new Map((venueData.racers || []).map((r) => [Number(r.regno), r]));
    const entrants = [];
    for (const racer of today.racers || []) {
      const entry = (racer.entries || []).find((e) => Number(e.place_no) === placeNo && Number(e.race_no) === raceNo);
      if (!entry || !Number(entry.boat_no)) continue;
      const regno = Number(racer.regno);
      let titles = [];
      let nationalByCourse = {};
      try { titles = featureTitles(await json(`features/${regno}.json`)); } catch { /* optional */ }
      try {
        const detail = await json(`racers/${regno}.json`);
        nationalByCourse = Object.fromEntries((detail.course_stats || []).map((c) => [String(c.course), c.rates?.national_same_course?.ren3 ?? null]));
      } catch { /* optional */ }
      entrants.push({ boat: Number(entry.boat_no), regno, name: racer.name || "", titles, nationalByCourse, venue: venueByRegno.get(regno) || null });
    }
    entrants.sort((a, b) => a.boat - b.boat);
    return res.status(200).json({
      race: { date, venue, placeNo, raceNo },
      baselines: venueData.baselines?.ALL || {},
      entrants: entrants.map((r) => ({ boat:r.boat, regno:r.regno, name:r.name, titles:r.titles, nationalByCourse:r.nationalByCourse, courses:(r.venue?.courses || []).map((c) => ({ course:Number(c.course), n:Number(c.n || 0), ren3_n:Number(c.ren3_n || 0) })) })),
      shrinkageK: Number(venueData.shrinkage_k || 15),
    });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: "wake_beta_unavailable" });
  }
}
