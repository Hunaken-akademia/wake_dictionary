-- WAKE辞典 v1.3.1 完了日スナップショット確認（SELECTのみ）

select
  generated_on,
  data_end,
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
  winner_status_false_races,
  winner_status_unknown_races
from public.wake_dictionary_metadata_v1;

with c as (
  select regno, sum(n) as course_n
  from public.wake_dictionary_course_stats_v1
  group by regno
)
select
  r.regno,
  r.total_starts,
  coalesce(c.course_n,0) as course_n,
  coalesce(c.course_n,0) - r.total_starts as diff
from public.wake_dictionary_racers_v1 r
left join c using (regno)
where coalesce(c.course_n,0) <> r.total_starts
order by r.regno;
