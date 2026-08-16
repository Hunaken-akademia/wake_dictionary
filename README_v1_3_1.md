# WAKE辞典 v1.3.1 完了日スナップショット修正

## 原因
検証中に当日のK票がSupabaseへ追加されると、
`wake_dictionary_racers_v1` と `wake_dictionary_course_stats_v1` を
別タイミングで取得する間に母集団が変わる。

今回、
- 前回 `win_n<5 = 5837`
- 今回 `win_n<5 = 5836`
へ変化しており、実データが更新されたことも確認できる。

A1/A2/B1の別経路検証は3件ともPASSしているため、
集計式の不一致ではない。

## 修正
集計期間の終端をJSTの「生成日前日」に固定する。

例:
- generated_on = 2026-08-16
- data_end = 2026-08-15

これにより夜間Actions実行中に8/16のK票が増えても、
8/15までの完了データだけで全VIEWが安定する。

## 適用
1. Supabaseで `sql/01_wake_dictionary_views.sql` を再実行
2. `sql/06_completed_day_snapshot_check.sql` を実行
3. GitHub Actionsを再実行
