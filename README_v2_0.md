# WAKE辞典 v2.0 — 伏兵 / 意外な一面 / まくられ・差され耐性

## 1. 「B級の刺客」→「B級の伏兵」

ユーザーに見える名称だけ変更。
内部JSONファイル名 `ranking_b_attackers.json` は互換性維持のためそのままです。

表示:
**B級の伏兵**

定義は変えません:
B1・B2の中で、3〜6コースの1着率が級別基準を上回る選手。

---

## 2. 「この選手の意外な一面」

各選手ページに最大3件表示。

候補は以下4カテゴリから1件ずつ最大候補を取り、
閾値に対する強さが大きい順で最大3件。

### コース得意 / 苦手
- n >= 30
- 級別×コース基準へK=15で縮小
- 補正1着率の基準差が +8pt以上 / -8pt以下

### 決まり手偏重
- そのコースで1着20回以上
- 級別×コースの勝利内決まり手構成を基準
- alpha=30で縮小
- 基準より +20pt以上

### ST特性
- n >= 30
- そのコース平均STを本人全体平均へK=15で縮小
- 本人平均より0.02以上速い

### 場得意 / 苦手
- n >= 20
- 既存の場別K=15補正値を使用
- 3連対率が本人全場基準から±10pt以上

該当なし:
`特筆すべき偏りなし`

※ 補正OFFでも、この自動抽出判定だけは低母数の偶然を避けるため補正済み値を使用します。

---

## 3. まくられ耐性 / 差され耐性

直近1年。

対象イベント:
- 勝者の進入コース > 自分の進入コース
- 自分は2〜6着
- 勝者の決まり手が「まくり」→ まくられ
- 勝者の決まり手が「差し」→ 差され

「まくり差し」は含めません。

表示:
- 該当回数
- 平均着順
- 3着内率
- 全体基準平均着順
- 全体基準3着内率
- 基準差

8件未満:
`データ不足`

### 基準値
単純な全選手平均ではなく、
**本人が攻められた時の進入コース構成と同じ重みの全国平均**を使用。

これにより、
「1コースで攻められることが多い選手」と
「3コースで攻められることが多い選手」を
不公平に同じ基準で比較しません。

---

# 最初に1回だけ必要

Supabase SQL Editorで:

`sql/08_defense_stats.sql`

を実行してください。

既存テーブル、K票取り込み、既存集計VIEWは変更しません。

その後GitHub Actionsを実行。

---

# Actionsで確認するログ

```text
fetch defense stats (last 1 year)...
defense_rows=...
feature_files=1649 前後
insight_none_racers=...

[7] defense types PASS
[7] defense ranges/minimum-events PASS
[7] feature files=.../... PASS
[7] insights max3 PASS
[7] insight thresholds PASS
[7] defense payload sufficient>=8 PASS

WAKE dictionary global validation passed.
```

---

# 変更ファイル

- `sql/08_defense_stats.sql`
- `scripts/export_wake_dictionary.mjs`
- `scripts/validate_wake_dictionary.mjs`
- `src/main.js`
- `src/style.css`
- `.github/workflows/build-wake-dictionary.yml`

かな検索・本日出走・認証・既存補正ON/OFFはそのまま維持します。
