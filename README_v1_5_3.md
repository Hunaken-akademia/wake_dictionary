# WAKE辞典 v1.5.3

Vercel link エラー修正。

## 原因
前版では `.vercel/project.json` を GitHub Actions 内で手作りしていました。
`orgId` が実際のVercel内部IDと一致しない場合、
`vercel pull` が `Could not retrieve Project Settings` で停止します。

## 修正
`.vercel` を削除した上で、Vercel CLI自身に

- scope: `hunaken-akademia`
- project: `wake-dictionary`

を指定して正式にlinkさせます。

この版では `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` をworkflowから使用しません。
GitHub Secretsに残っていても問題ありません。

必要なのは:
- VERCEL_TOKEN
- SUPABASE_URL
- SUPABASE_SERVICE_KEY

です。
