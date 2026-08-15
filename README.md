# WAKE辞典 集計レイヤー v1.1

## 状態

このパッケージは **STEP 1 / STEP 2 の実装**と、**STEP 3を実行するための検証コード**です。

ただし、依頼仕様どおり **STEP 3の実DB検証が完了するまでは「完成」とは扱いません**。
この環境からSupabase本体へ直接接続できないため、A1/A2/B1各1名の実行結果と、
全体検証の実測値はまだ未確定です。

---

## STEP 0で実データ確認済み

- race_results期間: 2025-07-07〜2026-08-15
- 総出走行: 349,647
- 総レース: 58,862
- 選手: 1,649
- boat != course: 32,587行
- production is_f: 819行
- staging L: 37行
- staging特殊状態: 4,666行
- 返還関連候補レース: 1,545

決まり手:
- 逃げ 31,388
- まくり 9,727
- まくり差し 7,371
- 差し 7,023
- 抜き 3,845
- 恵まれ 491

注意:
- kimariteは1着以外にも1,108行入っていたため、集計では `rank=1` を必須化。
- stagingのFはSTが正値で保存されている（例 F0.01 -> 0.010）。
  したがってF判定をST符号だけに依存しない。
- Lは37行中23行ST NULL、14行は正値。
- races_stagingのheld_status実分布は空だったため、これを不成立判定の主軸にはしない。
- racer_masterに級別・支部カラムは存在しない。

---

## ファイル

### `sql/01_wake_dictionary_views.sql`
集計ビューを作成します。

既存テーブルは変更しません。

作成する専用ビュー:
- wake_dictionary_base_24m_v1
- wake_dictionary_metadata_v1
- wake_dictionary_racers_v1
- wake_dictionary_national_course_v1
- wake_dictionary_course_stats_v1
- wake_dictionary_national_win_kimarite_v1
- wake_dictionary_win_kimarite_v1
- wake_dictionary_venue_stats_v1

### `scripts/export_wake_dictionary.mjs`
Supabaseから集計ビューを読み、
- `public/data/index.json`
- `public/data/metadata.json`
- `public/data/racers/{登録番号}.json`
を生成します。

サイト本番ではDB接続不要です。

### `scripts/validate_wake_dictionary.mjs`
STEP 3検証用。

### `sql/02_global_validation.sql`
SQL Editorで全体整合性を見るためのSELECT-only検証SQLです。

### `.github/workflows/build-wake-dictionary.yml`
毎晩JSON生成 + 検証のテンプレートです。
既存の `ingest_k.mjs` 等には触りません。

---

## 集計仕様

### A/B コース別

`選手 × 実進入course(1〜6)`

- n
- 1着率 / 2連対率 / 3連対率
- 平均ST
- F数 / L数
- 全国同コース平均との差
- K=15の縮小推定

`λ = n / (n + 15)`

`adjusted = λ * raw + (1-λ) * national_same_course`

raw / adjusted / n を全部JSONに保存します。

### C 勝った時の決まり手

キー名は `win_kimarite_breakdown`。

1着だけを対象:
`rank=1 AND kimarite IN (6種)`

α=10:
`adjusted_i = (count_i + 10*national_share_i) / (win_n+10)`

- `sufficient = win_n >= 5`
- `notable = sufficient AND abs(adjusted_diff_pt) >= 15`

`sufficient=false`でも統計値自体はJSONに残します。
サイト側では仕様どおり率を非表示にし、本数だけ表示してください。

### D 場別

`選手 × place_no`

コースは潰します。

縮小先は「本人の全場平均」。
これは仕様の「本人の全場平均との差」をそのまま基準にしています。

K=15:
`adjusted = λ*venue_raw + (1-λ)*personal_all_venue`

---

## E 除外・扱い

### 不成立
- `races.excluded_from_analysis=true` のレースを除外。
- さらに有効な1着(rank=1)が存在しないレースを除外。

### 返還発生レース
レース自体が成立して1着が存在する場合は除外しません。
通常結果を持つ他艇の成績も有効として扱います。

### F/L
- 出走数nには含める。
- 平均STから除外。
- F数/L数は別保持。
- Fは `st<0` だけで判断せず、staging status / is_fも使用。
- Lはstaging result_status='L'で判定。

### 選手責任外の欠場
`ABSENT / SCRATCHED / CANCELLED` は非出走としてnから除外。

### OTHER
意味を推測しません。
成立レース内で非出走statusでない場合は出走として残します。

---

## 級別・支部

監査済み `racer_master` に級別・支部がありません。

そのためv1では:

```json
{
  "grade": null,
  "branch": null
}
```

とします。

推測値は入れません。
将来、実カラムまたは別の確認済み公式マスターが追加された時点で埋めます。

`index.json`には仕様どおり
`regno / name / grade / branch`
だけを入れています。

---

## 導入

1. Supabase SQL Editorで:

`sql/01_wake_dictionary_views.sql`

を実行。

2. GitHub Secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

3. JSON生成:

```bash
node scripts/export_wake_dictionary.mjs
```

4. 全体検証:

```bash
node scripts/validate_wake_dictionary.mjs
```

---

## STEP 3 A1/A2/B1検証

現在の確認済みDBには級別が無いため、
A1/A2/B1をDBから自動選定すると「推測」になります。

級別が外部で確認済みの実在3選手の登録番号をGitHub Variablesに設定:

- `VERIFY_A1_REGNO`
- `VERIFY_A2_REGNO`
- `VERIFY_B1_REGNO`

その後:

```bash
node scripts/validate_wake_dictionary.mjs
```

を実行します。

各選手について、集計ビュー結果と
ベース行からの別経路再計算を照合しPASS/FAILを出します。

---

## 完成判定

以下が全部PASSして初めて完成です。

1. A1/A2/B1各1名の別経路照合 PASS
2. 全選手で `sum(course.n) == total_starts`
3. 全国決まり手分布がcourseごとに100%
4. `win_n < 5` の実測割合を確認
5. JSON生成が完走し、index.jsonが500KB未満


## v1.1修正

SupabaseはUTC基準のため `current_date` だとJST深夜に前日扱いになることを実測で確認。期間基準日を `(now() at time zone 'Asia/Tokyo')::date` に修正。
