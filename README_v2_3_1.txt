WAKE辞典 v2.3.1 — 本日出走表取得の安定化

今回の症状:
「本日出走のみ」が「出走情報未取得」になり無効化される。

修正内容:
1. collect_today_entries.mjs
   - 日付は必ずAsia/Tokyo（JST）で決定
   - BOATCAST取得を最大3回retry
   - no-store + cache bustingで古いCDN応答を避ける
   - 1Rだけでなく1R/2Rをprobe
   - probeが全滅した場合は24場×12Rを総当たりして1回だけ復旧
   - 0選手のまま本番デプロイしない（Actionを失敗させる）

2. build-wake-dictionary.yml
   - デプロイ前に today_entries.json の date がJST当日か検証
   - racer_count > 0 を検証
   - 前日ファイルや空ファイルをProductionへ出さない

3. src/main.js
   - today_entries.jsonがJST当日分かクライアント側でも確認
   - staleなら「本日分を更新待ち」と表示
   - 前日の出走情報を誤って「本日」として使わない

変更ファイル:
- scripts/collect_today_entries.mjs
- .github/workflows/build-wake-dictionary.yml
- src/main.js

SQL再実行不要。
この3ファイルをそのまま上書きしてGitHub Actionsを再実行してください。

正常ログ例:
today_entries_date=2026-08-17
active_places=...
today_racer_count=...
today_places=...

today_entries_check file_date=2026-08-17 jst_today=2026-08-17 racers=...
