# WAKE辞典 v2.1 — 差分更新 + ランキング表示改善

## 変更1：全1,649人の重い再取得をやめる

### 初回だけ
`wake_dictionary_incremental_cache_v1` が空なので、現在の全選手を1回だけseedします。

### 2回目以降
重い集計VIEWを再取得する対象は次だけです。

- 前回更新後に新しい結果が入った選手
- 24か月窓から古い結果が抜ける選手
- 1年の耐性窓から古い結果が抜ける選手
- 後からDBに追加された過去レースに関係する選手
- 新規選手 / キャッシュ未作成選手

出場も境界落ちもない選手は、既存のraw集計キャッシュを再利用します。

ただし全国基準・級別基準・ランキングは、全キャッシュraw値からNode側で毎回再計算するため、
**出場していない選手の補正値も全国基準の変化を反映**します。

### 過去データを手動修正した場合
GitHub Actionsの `Run workflow` に

`force_full_refresh`

を追加しています。既存行そのものを過去日に遡って修正した時だけONにしてください。
通常の毎朝更新ではOFFのままでOKです。

---

## 変更2：ランキング表示

「実測」「補正」という抽象的な列名をやめ、ランキングの意味が分かる名称を主表示にしました。

例：B級の伏兵

`1着率 24.8%`
`（実測 23.1%）`

補正ON時は補正後の率を大きく表示し、生の実測値を括弧内に表示します。

ランキングごとの表示名：

- B級の伏兵 → `1着率`
- まくり職人 → `まくり1着率`
- 差し名人 → `差し1着率`
- イン最強 / イン不安定 → `逃げ1着率`
- ダッシュ巧者 → `3連対率`
- スタート巧者 → ST表示のまま

補正OFF時は主値が実測値になり、`（実測）` と表示します。

---

# 最初に1回だけ必要

Supabase SQL Editorで：

`sql/10_incremental_cache.sql`

を実行してください。

このSQLは新規キャッシュテーブル・raw defense VIEW・indexだけを追加します。
既存テーブルの DROP / TRUNCATE / DELETE / ALTER はありません。

**v2.1を使う場合、v2.0.2の `sql/09_defense_stats_fast.sql` は不要です。**
耐性はv2.1のraw defense cache方式に置き換わります。

その後、このZIPを上書きしてGitHub Actionsを実行します。

---

# 初回の期待ログ

```text
WAKE dictionary v2.1 incremental cache refresh start
cache_mode=FULL_SEED
racer_total=1649
cache_refresh_racers=1649
cache_reuse_racers=0
...
WAKE dictionary incremental cache refresh complete
```

初回は全選手seedのため時間がかかります。

# 2回目以降の期待ログ

```text
cache_mode=DELTA
racer_total=1649
cache_refresh_racers=200前後など
cache_reuse_racers=1400前後など
```

実際の人数はその日の出走・期間境界で変わります。

Exporter側は：

```text
fetch incremental aggregate cache...
incremental_cache_racers=1649
course_rows(cache)=...
venue_rows(cache)=...
kimarite_rows(cache)=...
defense_raw_rows(cache)=...
```

となり、全1,649人について重いVIEWを再取得しません。

---

# 変更ファイル

- `.github/workflows/build-wake-dictionary.yml`
- `sql/10_incremental_cache.sql`
- `scripts/refresh_incremental_cache.mjs`
- `scripts/export_wake_dictionary.mjs`
- `scripts/validate_wake_dictionary.mjs`
- `src/main.js`

かな検索・本日出走・認証・補正ON/OFF・伏兵・意外な一面・耐性は維持します。
