WAKE辞典 v2.1.1 validation修正

今回のFAIL原因:
v2.1から[4]の独立検証対象をDB VIEWから「実際に生成された racer JSON」に変更しました。
しかし racer JSON は表示用に1着率・2連対率・3連対率・平均STを小数3桁へ丸めています。

旧validatorは未丸め値を1e-8で比較していたため、
A1 / A2 / B1すべてが正しいデータでもFAILし得る状態でした。

修正:
- n / 1着数 / 2連数 / 3連数 / F / L は完全一致のまま
- 率 / 平均STはexporterと同じ小数3桁へ丸めてから比較
- コース集合自体も一致確認
- 本当に不一致なら mismatch sample をログ出力

変更ファイル:
- scripts/validate_wake_dictionary.mjs

SQL再実行不要。
incremental cache再構築も不要。
この1ファイルを上書きしてActionsを再実行してください。
