# WAKE辞典 v1.5.2

GitHub Actions が `package-lock.json` 不在で停止する問題を修正。

変更:
- setup-node の npm cache 指定を削除
- `npm ci` → `npm install --no-audit --no-fund`
- Node 20 → Node 24

変更ファイルは `.github/workflows/build-wake-dictionary.yml` のみ。
