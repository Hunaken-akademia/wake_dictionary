# WAKE辞典 v1 実装・検証報告

## 実装済み

- 直近24ヶ月ローリング集計
- 選手×実進入コース成績
- K=15縮小推定
- 勝利時決まり手6分類
- α=10ディリクレ縮小
- sufficient / notableフラグ
- 選手×場成績
- JSON 1選手1ファイル
- 軽量index.json
- 夜間GitHub Actionsテンプレート
- グローバル検証スクリプト

## 実データに基づく重要修正

### 決まり手
DB上ではkimariteが1着以外にも1,108行存在したため、
`rank=1` を集計条件に固定した。

### F
stagingではFのSTが正値だった。
`result_status='F' OR is_f=true OR st<0`
でF判定し、平均STから除外する。

### L
staging `result_status='L'` を使用。
STがNULLでも正値でも平均から除外する。

### 不成立
held_statusは実データで空だったため依存しない。
`excluded_from_analysis=true` または「1着なし」を不成立扱いとして除外する。

### 欠場
ABSENT / SCRATCHED / CANCELLED を非出走扱いとする。

## 未完了

STEP 3の実DB実行結果。

特にA1/A2/B1は、監査済みDBに級別フィールドがないため
登録番号を安全に自動選定できない。
外部で級別確認済みの3登録番号を指定して検証する。

このため、本パッケージは「実装済み・本番認証前」の状態。
