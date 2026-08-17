WAKE辞典 v2.3.2 — 差分キャッシュの後日訂正対策

今回のValidation FAIL:
A1 regno=3946 で
- nは一致
- win_n / ren2_n / ren3_nだけ生成側が+1
となっていました。

これは「走数は変わっていないが、既存のrace_results行のrank等が後から訂正された」
時に起きる典型的な差分キャッシュのズレです。

v2.1差分更新は新規行(created_at)や期間境界は拾えますが、
既存行のUPDATEでcreated_atが変わらない場合は検知できません。

修正:
- 毎朝、直近3日間に走った選手だけを再計算対象へ追加
- 全1649人は再計算しない
- rank / kimarite / ST等の直近訂正を自動で吸収

重要:
現在すでに残っている過去のズレを一度消すため、
このパッチ適用後の最初の1回だけ GitHub Actions の
`force_full_refresh` を ON にして実行してください。

その1回が通った後は通常の自動実行でOKです。

変更ファイル:
- scripts/refresh_incremental_cache.mjs
- .github/workflows/build-wake-dictionary.yml

SQL再実行不要。
