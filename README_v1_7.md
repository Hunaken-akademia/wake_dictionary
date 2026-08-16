# WAKE辞典 v1.7

## 今回の変更

### 1. 選手検索の候補が下のカードに重ならない
検索候補をabsolute overlayから通常フローに変更。
候補が出ると、下の「逆引き検索」「ランキング」カードがその分だけ下へ押し下がります。

### 2. 「本日出走のみ」を追加
毎朝のActionsで公式BOATCAST str3の当日出走表を取得して
`public/data/today_entries.json`
を生成。

利用箇所:
- トップの選手検索
- 逆引き検索
- ランキング

対象選手には
`本日 平和島 3R・9R`
のように出走予定も表示します。

### 3. かな検索について
現状の `index.json` には読み仮名が無いため、
漢字名「峰竜太」を「みね」で正確に検索することはまだできません。

漢字から読みを推測する実装は誤読が起きるため採用しません。

代わりに、今回の `collect_today_entries.mjs` が
BOATCAST str3内に読み仮名らしい列があるか位置を決め打ちせず診断し、

- `kana_candidate_sample_count=...`
- `kana_candidate_samples=...`

をActionsログへ出します。

このログで公式データ内の読み仮名列を確認できれば、
次版で全選手の読みを正式に自動収集して
「みね → 峰竜太」の検索を実装できます。

## 変更ファイル
- `src/main.js`
- `src/style.css`
- `scripts/collect_today_entries.mjs`
- `.github/workflows/build-wake-dictionary.yml`

SQL・集計式・既存exporterは変更していません。
