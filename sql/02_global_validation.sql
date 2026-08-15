-- ============================================================================
-- WAKE辞典 v1 グローバル検証SQL
-- SELECTのみ。結果確認用。
-- ============================================================================

-- 1) コース別n合計 == 選手総出走数
with c as (
  select regno, sum(n) as course_n
  from public.wake_dictionary_course_stats_v1
  group by regno
)
select
  r.regno,
  r.racer_name,
  r.total_starts,
  coalesce(c.course_n,0) as course_n,
  coalesce(c.course_n,0) - r.total_starts as diff
from public.wake_dictionary_racers_v1 r
left join c using (regno)
where coalesce(c.course_n,0) <> r.total_starts
order by abs(coalesce(c.course_n,0)-r.total_starts) desc, r.regno;

-- 期待: 0 rows


-- 2) 全国・同コースの決まり手分布が100%
select
  course,
  sum(national_rate) as total_pct,
  abs(sum(national_rate)-100.0) as abs_error
from public.wake_dictionary_national_win_kimarite_v1
group by course
order by course;

-- 期待: course 1〜6すべて100


-- 3) 1着n<5の薄いセル割合
with cells as (
  select distinct regno, course, win_n
  from public.wake_dictionary_win_kimarite_v1
)
select
  count(*) as racer_course_cells,
  count(*) filter (where win_n < 5) as win_n_lt5_cells,
  round(
    100.0 * count(*) filter (where win_n < 5) / nullif(count(*),0),
    2
  ) as win_n_lt5_pct
from cells;


-- 4) 選手単位で総1着数<5の割合
with cells as (
  select distinct regno, course, win_n
  from public.wake_dictionary_win_kimarite_v1
),
r as (
  select regno, sum(win_n) as total_wins
  from cells
  group by regno
)
select
  count(*) as racers,
  count(*) filter (where total_wins < 5) as racers_total_wins_lt5,
  round(
    100.0 * count(*) filter (where total_wins < 5) / nullif(count(*),0),
    2
  ) as racers_total_wins_lt5_pct
from r;


-- 5) データ品質メタ
select * from public.wake_dictionary_metadata_v1;
