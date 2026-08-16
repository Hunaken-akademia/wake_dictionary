# WAKE辞典 v1.8 公開前仕上げ + 高速化

## この版でまとめて対応

### 1. 有料販売向けJSON保護
従来の `public/data/*` をそのまま公開しない。
Actionsで検証PASS後に `private-data/` へ移し、Vercel Serverless Function `api/data.js` 経由でのみ配信する。

- `/data/racers/xxxx.json` の直接URLは本番に存在しない
- `/api/data?path=...` は認証Cookieがないと 401
- Cookieは HttpOnly / Secure / SameSite=Lax
- 30日間保持
- 共通パスワード方式なので、購入者側はGoogleログイン不要

### Vercelに必ず設定するEnvironment Variables
Productionに以下を追加:

- `WAKE_DICTIONARY_PASSWORD`
  - 購入者に案内する共通パスワード
- `WAKE_DICTIONARY_SESSION_SECRET`
  - 32文字以上のランダム文字列。購入者には公開しない

未設定の場合はfail-closedでログインできない。

### 2. 検索候補の重なり
v1.7の修正を維持。候補は通常フローで表示し、下のカードを押し下げる。

### 3. 本日出走フィルター
v1.7を維持しつつ高速化。
最初に24場の1Rだけprobeし、開催中の場だけ2〜12Rを取得。

旧: 最大288リクエスト
新: 24 + 開催場数×11

### 4. かな検索
名前の読みを推測しない。
`collect_today_entries.mjs` の診断ログでBOATCAST内に公式読み候補が存在するか確認する。
`kana_candidate_samples=...` が取れれば次版で正式実装。

### 5. 決まり手詳細の母数対策
レビュー指摘を「選手詳細の勝利内決まり手構成」に適用。

- 率表示条件: 勝利数5以上 → **20以上**
- Dirichlet alpha: 10 → **30**
- 20勝未満は回数だけ表示し、率は非表示

注意: v1.4の「まくり職人/差し名人ランキング」はすでに分母が総出走数なので、
レビューにあった「ランキング分母が勝利数」という指摘は現実装には該当しない。そこは変更していない。

### 6. イン不安定
補正値が少母数を基準側へ戻すのは意図した挙動。
ただし低母数の影響をさらに抑えるため、イン不安定だけ既定最低走数を **50** に変更。
ユーザーはUIで変更可能。

### 7. Actions失敗時の前日版維持
デプロイ前に
- JSON生成
- global validation
- v1.8追加validation
- today entries
を完了させる。

どこか1つでも失敗したら `vercel deploy --prod` へ進まない。
そのため前回成功版を維持する。

### 8. Actions高速化
低リスク側で実施:

- npm download cache
- `npm install --prefer-offline`
- Vercel CLIのglobal installを廃止し固定版npx
- course batch 25→50（timeout時は既存の自動二分割）
- venue batch 25→50（同上）
- kimarite batch 5→10（同上）
- today entriesとvalidationを並列実行
- today entriesは開催場probe方式

Supabaseで57014が出た場合は、従来どおりそのバッチだけ自動で半分に分割する。
速度を上げるために集計式や既存K票データは変更しない。

## 変更ファイル
- `.github/workflows/build-wake-dictionary.yml`
- `scripts/export_wake_dictionary.mjs`
- `scripts/validate_wake_dictionary.mjs`
- `scripts/collect_today_entries.mjs`
- `src/main.js`
- `src/style.css`
- `api/login.js`
- `api/session.js`
- `api/logout.js`
- `api/data.js`
- `lib/auth.js`
- `vercel.json`

## 適用前にやること
1. Vercel Project Settings → Environment Variables
2. Productionに `WAKE_DICTIONARY_PASSWORD` を追加
3. Productionに `WAKE_DICTIONARY_SESSION_SECRET` を追加
4. このZIPをrepo直下へ上書き
5. GitHub ActionsをRun

## 最後に確認
- validationがPASS
- today_racer_countが0ではない（開催日なら）
- `Vercel deployment verified.`
- 本番URLでパスワード画面が出る
- 正しいパスワードで辞典が開く
- 本番 `/data/index.json` が404になる
- 未認証で `/api/data?path=index.json` が401になる
