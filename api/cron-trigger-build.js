// WAKE辞典の毎日ビルド・デプロイ(build-wake-dictionary.yml)の発火専用cron。
//
// 経緯: このワークフローのGitHub Actions schedule発火(本来07:55 JST)が
// 2026-08-28は15:23 JST頃まで7時間半遅延した上、その回はrefresh_incremental_
// cache.mjsのwake_dictionary_metadata_v1クエリがstatement timeoutで失敗し、
// 「本日出走」を含む静的データが1日中前日分のまま公開され続けた
// (newhunaken456のcapture-nightly-ai-predictions.ymlと同じスケジュール輻輳)。
//
// ビルド自体はSupabase集計・Vercel CLIデプロイを含む数分がかりの処理で
// Vercelサーバーレス関数には収まらないため、GitHub Actions側の処理は
// そのまま使う。ここではVercel Cron(GitHub側のスケジュール輻輳と無関係)から
// GitHub REST APIのworkflow_dispatchを直接叩き、発火だけを確実にする。

const GITHUB_OWNER = "Hunaken-akademia";
const GITHUB_REPO = "wake_dictionary";
const WORKFLOW_FILE = "build-wake-dictionary.yml";
const GITHUB_TOKEN = String(process.env.GITHUB_DISPATCH_TOKEN || "");

export default async function handler(req, res) {
  // Vercel CronはAuthorization: Bearer <CRON_SECRET>を自動付与する。
  // CRON_SECRETを設定していない間は検証をスキップし、設定したら自動的に有効化される。
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers?.authorization || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ ok: false, error: "GITHUB_DISPATCH_TOKEN is not set" });
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (r.status !== 204) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({ ok: false, error: `dispatch failed: ${r.status} ${text.slice(0, 200)}` });
    }
    return res.status(200).json({ ok: true, dispatched: WORKFLOW_FILE });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
