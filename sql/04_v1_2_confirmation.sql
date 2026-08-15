-- WAKE辞典 v1.2 確認SQL（SELECTのみ）
-- 期待値（2026-08-16時点の監査結果）:
-- no_winner_races = 178
-- winner_status_false_races = 169
-- winner_status_unknown_races = 9

select
  generated_on,
  requested_start,
  raw_start,
  raw_end,
  actual_start,
  actual_end,
  raw_rows,
  raw_races,
  usable_start_rows,
  usable_races,
  racers,
  no_winner_races,
  excluded_flag_races,
  winner_status_false_races,
  winner_status_unknown_races,
  staging_coverage_pct
from public.wake_dictionary_metadata_v1;
