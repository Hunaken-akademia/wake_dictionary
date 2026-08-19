import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { activeEntitlement, authenticatedGoogleUser } from "../lib/google-access.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "private-data");
const PLACE_NAMES = [null,"桐生","戸田","江戸川","平和島","多摩川","浜名湖","蒲郡","常滑","津","三国","びわこ","住之江","尼崎","鳴門","丸亀","児島","宮島","徳山","下関","若松","芦屋","福岡","唐津","大村"];
const ALLOWED_ORIGINS = new Set([
  "https://newhunaken456.vercel.app",
  "https://newhunaken456-hunaken-akademia.vercel.app",
  "https://wake-dictionary.vercel.app",
]);

async function json(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

function pct(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function featureTitles(value, placeNo) {
  const out = [];
  for (const item of value?.insights?.items || []) {
    let label = null;
    if (item.type === "kimarite_bias") label = item.kimarite === "差し" ? "差し名人" : item.kimarite === "まくり" ? "まくり職人" : item.kimarite === "まくり差し" ? "まくり差し巧者" : null;
    if (item.type === "venue_ren3" && item.direction === "strong" && Number(item.place_no) === Number(placeNo)) label = "当地巧者";
    if (item.type === "course_win" && item.direction === "strong") label = `${item.course}コース巧者`;
    if (item.type === "st_fast") label = "スタート巧者";
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= 2) break;
  }
  return out.slice(0, 2);
}

export default async function handler(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin) || /^https:\/\/newhunaken456-[a-z0-9-]+-hunaken-akademia\.vercel\.app$/i.test(origin)) {
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
  if (!await activeEntitlement(user)) return res.status(403).json({ error: "dictionary_access_required" });

  const venue = String(req.query?.venue || "");
  const regnos = String(req.query?.regnos || "").split(",").map(Number).filter((v) => Number.isInteger(v) && v > 0).slice(0, 6);
  const placeNo = PLACE_NAMES.indexOf(venue);
  if (placeNo < 1 || regnos.length !== 6) {
    return res.status(400).json({ error: "invalid_race" });
  }

  try {
    const venueData = await json(`index/venue_${String(placeNo).padStart(2, "0")}.json`);

    const venueByRegno = new Map((venueData.racers || []).map((r) => [Number(r.regno), r]));
    const entrants = [];
    for (let index = 0; index < regnos.length; index++) {
      const regno = regnos[index];
      let titles = [];
      let nationalByCourse = {};
      let nationalCourses = [];
      let name = venueByRegno.get(regno)?.name || "";
      try { titles = featureTitles(await json(`features/${regno}.json`), placeNo); } catch { /* optional */ }
      try {
        const detail = await json(`racers/${regno}.json`);
        name = detail?.racer?.name || name;
        nationalByCourse = Object.fromEntries((detail.course_stats || []).map((c) => [String(c.course), c.rates?.national_same_course?.ren3 ?? null]));
        nationalCourses = (detail.course_stats || []).map((c) => ({ course:Number(c.course), n:Number(c.n || 0), win_n:Number(c.finish_counts?.win || 0), ren3_n:Number(c.finish_counts?.ren3 || 0) }));
      } catch { /* optional */ }
      entrants.push({ boat: index + 1, regno, name, titles, nationalByCourse, nationalCourses, venue: venueByRegno.get(regno) || null });
    }
    entrants.sort((a, b) => a.boat - b.boat);
    return res.status(200).json({
      race: { venue, placeNo },
      baselines: venueData.baselines?.ALL || {},
      entrants: entrants.map((r) => ({ boat:r.boat, regno:r.regno, name:r.name, titles:r.titles, nationalByCourse:r.nationalByCourse, nationalCourses:r.nationalCourses, courses:(r.venue?.courses || []).map((c) => ({ course:Number(c.course), n:Number(c.n || 0), win_n:Number(c.win_n || 0), ren3_n:Number(c.ren3_n || 0) })) })),
      shrinkageK: Number(venueData.shrinkage_k || 15),
    });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: "wake_beta_unavailable" });
  }
}
