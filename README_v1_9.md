# WAKE辞典 v1.9 — 公式プロフィール読み仮名 / かな検索

## できるようになる検索

例: 峰竜太（登録4320）

- `峰`
- `みね`
- `ミネ`
- `みねりゅうた`
- `ミネリュウタ`
- `4320`

すべて同じ選手を候補に出せます。

## 読み仮名の取得元

公式 BOAT RACE 選手プロフィール:

`https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban={登録番号}`

漢字名から読みを推測せず、公式プロフィールに表示されるカナを使用します。

## 永続化

新規テーブル:

`public.wake_dictionary_racer_kana_v1`

初回だけ未取得選手の公式プロフィールを取得。
以後は、

- kana未取得
- 新規選手
- 同じ登録番号で氏名が変わった

場合だけ再取得します。

そのため、初回Actionsはプロフィール取得分だけ時間が増えますが、
2回目以降は通常ほぼ追加コストなしです。

## 最初に1回だけ必要

Supabase SQL Editorで:

`sql/07_racer_kana.sql`

を実行してください。

既存テーブルは変更しません。

## Actionsログの期待値

初回:
- `racer_total=1649` 前後
- `kana_to_fetch=1649` 前後
- `kana_valid_total=...`
- `kana_coverage_pct=...`

2回目以降:
- `kana_to_fetch=0` 前後

90%以上取得できなければ、誤った読み仮名を公開しないためActionsを停止します。

## 変更ファイル

- `sql/07_racer_kana.sql`
- `scripts/collect_racer_kana.mjs`
- `scripts/export_wake_dictionary.mjs`
- `src/main.js`
- `src/style.css`
- `.github/workflows/build-wake-dictionary.yml`

既存のK票取り込み・集計SQL・補正ロジックは変更していません。
