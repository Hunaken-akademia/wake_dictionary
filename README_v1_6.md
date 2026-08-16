# WAKE辞典 v1.6 — 用語説明・補正ON/OFF・Vercel最終確認修正

## 変更
### 1. 用語ガイド
ヘッダーの「？ 用語」から以下を説明:
- 実測
- 補正値
- 補正ON/OFF
- 基準値 / 基準差
- 母数(n)
- 最低走数
- 逆引き検索
- B級の刺客
- まくり職人 / 差し名人
- イン最強 / イン不安定
- ダッシュ巧者
- スタート巧者 / Fなし
- 決まり手

### 2. 補正ON/OFF
デフォルトはON。端末のlocalStorageに保存。

ON:
- 補正値で順位付け
- 実測＋補正＋基準差を表示

OFF:
- 補正値を順位に使わない
- 実測値で順位を作り直す
- 補正列を非表示
- 可能な一覧では実測値−基準値を表示
- 選手詳細も実測データ中心表示

### 3. B級の刺客
画面内に説明を追加:
「B1・B2の中から、3〜6コースの1着率がその級別の基準を上回る選手を抽出。外・中コースから穴を開ける候補を探すランキング」

### 4. GitHub Actions最後の確認
`curl $WAKE_DEPLOY_URL/data/index.json` を廃止。
Deployment ProtectionでHTMLが返りJSON.parseが失敗するため。

代わりに:
`vercel inspect "$WAKE_DEPLOY_URL" ...`
で認証済みCLIからデプロイ成立を確認。

JSON本体はデプロイ直前の `Confirm generated data exists` で
index / baselines / reverse_catalog / ranking_catalog / racer filesを確認済み。

## 変更ファイル
- `src/main.js`
- `src/style.css`
- `.github/workflows/build-wake-dictionary.yml`

SQL・exporter・集計式は変更なし。
