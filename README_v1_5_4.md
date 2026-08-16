# WAKE辞典 v1.5.4 metadata timeout修正

今回の停止箇所:
`wake_dictionary_metadata_v1 500 / code 57014 / statement timeout`

原因:
`metadata_v1`・`racers_v1`・`racer_profile_v1` を `Promise.all` で同時取得していたため、
metadata側の重い内部集計と他VIEW取得がSupabase上で競合していました。

修正:
- metadata → racers → racer profiles を完全に順番取得
- 57014のstatement timeout時だけ最大4回再試行
- 既存の course / venue / kimarite の適応分割処理はそのまま
- SQL、集計式、JSON仕様、workflowには変更なし

変更ファイル:
- `scripts/export_wake_dictionary.mjs`

ZIPをrepo直下へ上書きしてGitHub Actionsを再実行してください。
