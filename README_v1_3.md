# WAKE辞典 v1.3 級別・支部自動取得パッチ

追加内容:
- WAKE辞典専用の選手プロフィールテーブル
- BOATCAST str3から登録番号/氏名/級別/支部を自動取得
- exporterが級別・支部をJSONへ反映
- validatorがA1/A2/B1を自動選出
- Actionsでプロフィール更新→JSON生成→検証

適用順:
1. Supabaseで `sql/05_auto_racer_grade_branch.sql` を実行
2. GitHubへこのZIPの `scripts/` と `.github/workflows/` を上書き
3. Actionsを実行

既存のrace_results、ingest_k.mjs、WAKE本体は変更しません。
