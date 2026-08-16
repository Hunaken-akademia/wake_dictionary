# WAKE辞典 v1.4 逆引き検索・ランキングJSON パッチ

## 追加内容

既存の毎晩JSON生成に、設計仕様の★1と★2を追加します。

### ★1 逆引き検索
`public/data/index/` に以下を事前生成します。

- コース 1〜6
- 決まり手 6種
- 級別 ALL / A1 / A2 / B1 / B2

合計 **180ファイル**。

例:
- `reverse_course3_makurizashi_B1.json`
- `reverse_course1_nige_ALL.json`

各行:
- regno
- name
- grade
- branch
- n
- count
- rawRate
- adjRate
- baselineRate
- diffPtAdjusted

並び順は **補正値(adjRate)降順**。
JSONは全件保持し、UIの既定最低走数は30走を想定。

### ★2 ランキング
事前生成:
- B級の刺客
- まくり職人（A1/A2/B1/B2）
- 差し名人（A1/A2/B1/B2）
- イン最強（A1/A2/B1/B2）
- イン不安定（A1/A2/B1/B2）
- ダッシュ巧者（A1/A2/B1/B2）
- スタート巧者（A1/A2/B1/B2）
- スタート巧者 Fなし（A1/A2/B1/B2）

### 基準値
`public/data/meta/baselines.json`

級別×コースの
- 1着率
- 2連対率
- 3連対率
- 平均ST
- 決まり手別「その決まり手で勝った率 / 出走数」
を保存。

### 縮小推定
K=15固定。

率:
`adjusted = (count + 15 * baseline_probability) / (n + 15)`

平均ST:
`adjustedST = (ST合計 + 15 * baselineST) / (有効ST数 + 15)`

### 重要
「決まり手ランキング」の分母は **勝利数ではなく出走数**。
例:
`3コース62走中、まくり差し18勝 = 29.0%`

これにより設計書の「まくり1着18回 / 62走」の意味と一致します。

## 変更ファイル
- `scripts/export_wake_dictionary.mjs`
- `scripts/validate_wake_dictionary.mjs`

SQL追加なし。
workflow変更なし。
既存の毎晩 `Generate static JSON` と `Validate global aggregates` の中で自動実行されます。

## 適用
GitHubの `wake_dictionary` に、このZIPの2ファイルをそのまま上書きしてActionsを実行してください。
