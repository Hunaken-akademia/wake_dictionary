# WAKE辞典 v2.3 — 24場フィルター + 本日開催場連動

## 追加したもの

### 逆引き検索
「級別」の横に **場** を追加。

通常時:
- 全場
- 24場すべて

「本日出走のみ」ON:
- 本日開催している場だけ選択可能
- 「本日開催 全場」も選択可能
- 特定場を選んだ場合、その場に今日出走する選手だけに絞り込み

場を選んだ場合は単なる出走場フィルターではなく、
**その場での過去24ヶ月のコース×決まり手成績**で逆引きを作り直します。

### WAKEランキング
**場（本日開催）** フィルターを追加。

- 全場 → 従来ランキング
- 本日開催中の特定場 → その場での過去実績だけでランキング再計算
- 「本日出走のみ」と組み合わせ可能

例:
`宮島 × B1まくり職人 × 本日出走のみ`

→ 宮島での過去実績でランキングを作り、
今日宮島に出走する選手だけを残します。

## 差分更新
新規専用キャッシュ:
`wake_dictionary_venue_course_cache_v1`

初回だけ全選手。
以後はv2.1と同じ差分対象選手だけ更新します。

## 最初に1回だけ必要
Supabase SQL Editor:

`sql/11_venue_course_cache.sql`

を実行。

その後、ZIPを上書きしてActionsを実行。

既存データへの
DELETE / TRUNCATE / DROP / ALTER
はありません。

## 期待ログ
```text
venue_course_cache_existing=0
cache_refresh_racers=1649
refresh venue×course×kimarite rows...
venue_course_cache: batch 1/... racers=25 rows=...
...
venue_course_cache_racers=1649
venue_filter_files=24

[8] venue filter files=24 PASS
[8] venue row ranges PASS
[8] venue kimarite sum==wins PASS
[8] venue baselines PASS

WAKE dictionary global validation passed.
```

v2.2の
- 攻められ耐性を1件から表示
- 8件未満は参考値
- コース別決まり手ドーナツ
- v2.1差分更新
- v2.1.1 validation丸め修正

は維持しています。
