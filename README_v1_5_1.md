# WAKE辞典 v1.5.1 — Actions → Vercel 直接デプロイ

## 今回の404の原因
GitHub Actionsのrunner内では `public/data` が生成されていますが、
通常のVercel Git連携デプロイはGitHubリポジトリの内容だけを取得します。

そのためrunner内だけに存在する
`public/data/index.json`
などはVercelへ渡らず、画面は表示できても `/data/index.json` が404になります。

## 修正
Actionsで以下を1本につなぎます。

K票集計
→プロフィール更新
→JSON生成
→検証
→生成ファイル存在確認
→その同じrunnerからVercel本番へ直接deploy
→本番 `/data/index.json` のHTTP確認

`public/data` をpublic GitHub repoへcommitしません。

## GitHub Secretsに追加する3つ
既存:
- SUPABASE_URL
- SUPABASE_SERVICE_KEY

追加:
- VERCEL_TOKEN
- VERCEL_ORG_ID
- VERCEL_PROJECT_ID

### VERCEL_TOKEN
Vercel Dashboard → Account Settings → Tokens で作成。

### VERCEL_ORG_ID / VERCEL_PROJECT_ID
Vercelプロジェクトをローカルでlink済みなら `.vercel/project.json` の
`orgId` と `projectId`。
Vercel Dashboard / API経由でも確認できます。

## 適用
`.github/workflows/build-wake-dictionary.yml` を上書きして、
上記3 Secretを登録後、Actionsを手動実行。

最後に
`Verify deployed JSON`
が成功し、
`deployed racers=1649` 前後が出れば解消です。
