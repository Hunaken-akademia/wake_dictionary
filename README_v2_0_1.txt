WAKE辞典 v2.0.1 defense statement timeout 修正

今回の原因:
wake_dictionary_defense_stats_1y_v1 を1649選手分まとめて1回で取得していたため、
Postgres/Supabaseのstatement timeout (57014) に到達していました。

修正:
1. defense VIEWも選手10人ずつ取得
2. timeoutしたバッチだけ 10→5+5→3+2... と自動分割
3. 1選手まで分割可能
4. Validatorではdefense VIEWをもう一度全件取得しない
5. 実際にデプロイする public/data/features/*.json を検証

統計定義・耐性ロジック・UI・SQL VIEWの定義は変更していません。

変更ファイル:
- scripts/export_wake_dictionary.mjs
- scripts/validate_wake_dictionary.mjs

SQL再実行不要。
この2ファイルを上書きしてActionsを再実行してください。

期待ログ:
fetch defense stats (last 1 year)...
defense_batch_size=10
wake_dictionary_defense_stats_1y_v1: batch 1/165 racers=10 rows=...
...

もし10人でもtimeoutした場合:
wake_dictionary_defense_stats_1y_v1: statement timeout for 10 racers; split -> 5+5

と自動分割されます。
