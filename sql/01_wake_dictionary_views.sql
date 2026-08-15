-- ============================================================================
-- WAKE辞典 v1 集計ビュー
--
-- 目的:
--   公式K票由来の race_results を主ソースに、WAKE辞典の静的JSON生成用集計層を作る。
--
-- 安全性:
--   * 既存テーブルへの INSERT / UPDATE / DELETE / TRUNCATE / ALTER / DROP は行わない
--   * 既存取込みパイプラインには触れない
--   * このSQLが作るのは wake_dictionary_*_v1 という新規/専用VIEWのみ
--
-- 実データ監査で確認済みのカラムだけを使用:
--   race_results:
--     race_date, place_no, race_no, boat, course, regno, racer_name,
--     motor_no, st, is_f, rank, kimarite
--   race_results_staging:
--     race_date, place_no, race_no, boat_no, course, regno, racer_name,
--     finish_order, result_status, st, official_st_text, is_f, kimarite
--   races:
--     race_date, place_no, race_no, excluded_from_analysis
--   racer_master:
--     regno, racer_name
--
-- 重要:
--   racer_masterには「級別」「支部」が存在しないことが監査で確認済み。
--   そのためこのv1では grade / branch をNULLとして出力する。
--
-- 集計期間:
--   current_date を基準に直近24ヶ月。
--   DBに24ヶ月未満しか無い場合は、存在する最古日以降だけが実データ期間になる。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 24ヶ月の正規化ベース
--
-- 不成立レース:
--   races.excluded_from_analysis=true は除外。
--   さらに race_results に有効な1着(rank=1)が1艇も無いレースも除外する。
--
-- 返還レース:
--   F/L等が発生してもレース自体が成立して1着が存在する場合、レースは除外しない。
--   F/L艇は出走数nには含めるが、ST平均から除外する。
--
-- F/L:
--   stagingのresult_statusを優先して判定。
--   Fは production の is_f=true / st<0 も補助判定に使う。
--   実監査では staging のFのstは正値だったため「st<0だけ」でF判定しない。
--
-- 選手責任外の欠場:
--   staging result_status が ABSENT / SCRATCHED / CANCELLED の艇は非出走として除外。
--
-- OTHER:
--   内容を推測しない。レースが成立しており、非出走statusでもない場合は出走として残す。
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_base_24m_v1 as
with params as (
  select
    current_date as generated_on,
    (current_date - interval '24 months')::date as requested_start
),
race_validity as (
  select
    rr.race_date,
    rr.place_no,
    rr.race_no,
    bool_or(rr.rank = 1) as has_winner,
    coalesce(bool_or(coalesce(r.excluded_from_analysis, false)), false) as excluded_from_analysis
  from public.race_results rr
  cross join params p
  left join public.races r
    on r.race_date = rr.race_date
   and r.place_no = rr.place_no
   and r.race_no = rr.race_no
  where rr.race_date >= p.requested_start
    and rr.race_date <= p.generated_on
  group by rr.race_date, rr.place_no, rr.race_no
),
joined as (
  select
    rr.race_date,
    rr.place_no,
    rr.race_no,
    rr.boat,
    rr.course,
    rr.regno,
    rr.racer_name,
    rr.rank,
    rr.kimarite,
    rr.st,
    rr.is_f,
    s.result_status,
    s.official_st_text,
    rv.has_winner,
    rv.excluded_from_analysis,
    case
      when s.result_status in ('ABSENT', 'SCRATCHED', 'CANCELLED') then true
      else false
    end as is_non_start,
    case
      when s.result_status = 'F' then true
      when coalesce(rr.is_f, false) then true
      when rr.st < 0 then true
      else false
    end as is_f_norm,
    case
      when s.result_status = 'L' then true
      else false
    end as is_l_norm
  from public.race_results rr
  cross join params p
  join race_validity rv
    on rv.race_date = rr.race_date
   and rv.place_no = rr.place_no
   and rv.race_no = rr.race_no
  left join public.race_results_staging s
    on s.race_date = rr.race_date
   and s.place_no = rr.place_no
   and s.race_no = rr.race_no
   and s.boat_no = rr.boat
  where rr.race_date >= p.requested_start
    and rr.race_date <= p.generated_on
)
select
  j.race_date,
  j.place_no,
  j.race_no,
  j.boat,
  j.course,
  j.regno,
  j.racer_name,
  j.rank,
  case
    when j.rank = 1 and j.kimarite in ('逃げ','差し','まくり','まくり差し','抜き','恵まれ')
      then j.kimarite
    else null
  end as winner_kimarite,
  j.result_status,
  j.is_f_norm as is_f,
  j.is_l_norm as is_l,
  case
    when j.is_f_norm or j.is_l_norm then null
    when j.st is null then null
    when j.st < 0 then null
    else j.st::double precision
  end as st_for_average,
  (j.rank between 1 and 6) as has_valid_finish
from joined j
where j.has_winner
  and not j.excluded_from_analysis
  and not j.is_non_start
  and j.regno is not null
  and j.course between 1 and 6;


-- ----------------------------------------------------------------------------
-- 2. メタデータ / 品質情報
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_metadata_v1 as
with params as (
  select
    current_date as generated_on,
    (current_date - interval '24 months')::date as requested_start
),
raw_period as (
  select
    min(rr.race_date) as raw_start,
    max(rr.race_date) as raw_end,
    count(*) as raw_rows,
    count(distinct (rr.race_date, rr.place_no, rr.race_no)) as raw_races
  from public.race_results rr
  cross join params p
  where rr.race_date >= p.requested_start
    and rr.race_date <= p.generated_on
),
usable as (
  select
    min(race_date) as actual_start,
    max(race_date) as actual_end,
    count(*) as usable_start_rows,
    count(distinct (race_date, place_no, race_no)) as usable_races,
    count(distinct regno) as racers,
    count(*) filter (where is_f) as f_starts,
    count(*) filter (where is_l) as l_starts,
    count(*) filter (where st_for_average is null and not is_f and not is_l) as other_st_missing_rows
  from public.wake_dictionary_base_24m_v1
),
staging_coverage as (
  select
    count(*) as rr_rows,
    count(*) filter (where s.race_date is not null) as staging_matched_rows
  from public.race_results rr
  cross join params p
  left join public.race_results_staging s
    on s.race_date = rr.race_date
   and s.place_no = rr.place_no
   and s.race_no = rr.race_no
   and s.boat_no = rr.boat
  where rr.race_date >= p.requested_start
    and rr.race_date <= p.generated_on
),
excluded_races as (
  select
    count(*) filter (where not x.has_winner) as no_winner_races,
    count(*) filter (where x.excluded_flag) as excluded_flag_races
  from (
    select
      rr.race_date,
      rr.place_no,
      rr.race_no,
      bool_or(rr.rank = 1) as has_winner,
      coalesce(bool_or(coalesce(r.excluded_from_analysis,false)),false) as excluded_flag
    from public.race_results rr
    cross join params p
    left join public.races r
      on r.race_date = rr.race_date
     and r.place_no = rr.place_no
     and r.race_no = rr.race_no
    where rr.race_date >= p.requested_start
      and rr.race_date <= p.generated_on
    group by rr.race_date, rr.place_no, rr.race_no
  ) x
),
refund_related as (
  select count(*) as refund_related_races
  from (
    select distinct s.race_date, s.place_no, s.race_no
    from public.race_results_staging s
    cross join params p
    where s.race_date >= p.requested_start
      and s.race_date <= p.generated_on
      and s.result_status in ('F','L','ABSENT','SCRATCHED')
  ) q
)
select
  p.generated_on,
  p.requested_start,
  rp.raw_start,
  rp.raw_end,
  u.actual_start,
  u.actual_end,
  rp.raw_rows,
  rp.raw_races,
  u.usable_start_rows,
  u.usable_races,
  u.racers,
  u.f_starts,
  u.l_starts,
  u.other_st_missing_rows,
  sc.rr_rows as staging_coverage_denominator,
  sc.staging_matched_rows,
  round(100.0 * sc.staging_matched_rows / nullif(sc.rr_rows,0), 3) as staging_coverage_pct,
  er.no_winner_races,
  er.excluded_flag_races,
  ref.refund_related_races,
  false as grade_available,
  false as branch_available
from params p
cross join raw_period rp
cross join usable u
cross join staging_coverage sc
cross join excluded_races er
cross join refund_related ref;


-- ----------------------------------------------------------------------------
-- 3. 選手メタ
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_racers_v1 as
with latest_name as (
  select distinct on (b.regno)
    b.regno,
    b.racer_name
  from public.wake_dictionary_base_24m_v1 b
  order by b.regno, b.race_date desc, b.race_no desc, b.boat
),
totals as (
  select
    regno,
    count(*) as total_starts,
    min(race_date) as first_start_date,
    max(race_date) as last_start_date
  from public.wake_dictionary_base_24m_v1
  group by regno
)
select
  t.regno,
  coalesce(rm.racer_name, ln.racer_name) as racer_name,
  null::text as grade,
  null::text as branch,
  t.total_starts,
  t.first_start_date,
  t.last_start_date
from totals t
left join public.racer_master rm on rm.regno = t.regno
left join latest_name ln on ln.regno = t.regno;


-- ----------------------------------------------------------------------------
-- 4. 全国・同コース平均
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_national_course_v1 as
select
  course,
  count(*) as n,
  100.0 * count(*) filter (where rank = 1) / nullif(count(*),0) as win_rate,
  100.0 * count(*) filter (where rank between 1 and 2) / nullif(count(*),0) as ren2_rate,
  100.0 * count(*) filter (where rank between 1 and 3) / nullif(count(*),0) as ren3_rate,
  avg(st_for_average) as avg_st
from public.wake_dictionary_base_24m_v1
group by course;


-- ----------------------------------------------------------------------------
-- 5. (A)(B) 選手×コース成績 + K=15縮小推定
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_course_stats_v1 as
with raw as (
  select
    regno,
    course,
    count(*) as n,
    count(*) filter (where rank = 1) as win_n,
    count(*) filter (where rank between 1 and 2) as ren2_n,
    count(*) filter (where rank between 1 and 3) as ren3_n,
    avg(st_for_average) as avg_st,
    count(*) filter (where is_f) as f_count,
    count(*) filter (where is_l) as l_count,
    count(*) filter (where st_for_average is null and not is_f and not is_l) as st_missing_count,
    100.0 * count(*) filter (where rank = 1) / nullif(count(*),0) as raw_win_rate,
    100.0 * count(*) filter (where rank between 1 and 2) / nullif(count(*),0) as raw_ren2_rate,
    100.0 * count(*) filter (where rank between 1 and 3) / nullif(count(*),0) as raw_ren3_rate
  from public.wake_dictionary_base_24m_v1
  group by regno, course
)
select
  r.regno,
  r.course,
  r.n,
  r.win_n,
  r.ren2_n,
  r.ren3_n,
  r.avg_st,
  r.f_count,
  r.l_count,
  r.st_missing_count,
  r.raw_win_rate,
  r.raw_ren2_rate,
  r.raw_ren3_rate,
  n.win_rate as national_win_rate,
  n.ren2_rate as national_ren2_rate,
  n.ren3_rate as national_ren3_rate,
  r.raw_win_rate - n.win_rate as raw_win_diff_pt,
  r.raw_ren2_rate - n.ren2_rate as raw_ren2_diff_pt,
  r.raw_ren3_rate - n.ren3_rate as raw_ren3_diff_pt,
  r.n::double precision / (r.n + 15.0) as lambda,
  (
    (r.n::double precision / (r.n + 15.0)) * r.raw_win_rate
    + (15.0 / (r.n + 15.0)) * n.win_rate
  ) as adjusted_win_rate,
  (
    (r.n::double precision / (r.n + 15.0)) * r.raw_ren2_rate
    + (15.0 / (r.n + 15.0)) * n.ren2_rate
  ) as adjusted_ren2_rate,
  (
    (r.n::double precision / (r.n + 15.0)) * r.raw_ren3_rate
    + (15.0 / (r.n + 15.0)) * n.ren3_rate
  ) as adjusted_ren3_rate,
  (
    (r.n::double precision / (r.n + 15.0)) * r.raw_win_rate
    + (15.0 / (r.n + 15.0)) * n.win_rate
    - n.win_rate
  ) as adjusted_win_diff_pt,
  (
    (r.n::double precision / (r.n + 15.0)) * r.raw_ren2_rate
    + (15.0 / (r.n + 15.0)) * n.ren2_rate
    - n.ren2_rate
  ) as adjusted_ren2_diff_pt,
  (
    (r.n::double precision / (r.n + 15.0)) * r.raw_ren3_rate
    + (15.0 / (r.n + 15.0)) * n.ren3_rate
    - n.ren3_rate
  ) as adjusted_ren3_diff_pt
from raw r
join public.wake_dictionary_national_course_v1 n using (course);


-- ----------------------------------------------------------------------------
-- 6. (C) 全国・同コースの「勝った時の決まり手」分布
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_national_win_kimarite_v1 as
with kinds(kimarite) as (
  values ('逃げ'::text),('差し'),('まくり'),('まくり差し'),('抜き'),('恵まれ')
),
courses(course) as (
  values (1::smallint),(2::smallint),(3::smallint),(4::smallint),(5::smallint),(6::smallint)
),
wins as (
  select course, count(*) as win_n
  from public.wake_dictionary_base_24m_v1
  where rank = 1
  group by course
),
counts as (
  select course, winner_kimarite as kimarite, count(*) as kimarite_n
  from public.wake_dictionary_base_24m_v1
  where rank = 1
    and winner_kimarite is not null
  group by course, winner_kimarite
)
select
  c.course,
  k.kimarite,
  coalesce(w.win_n,0) as win_n,
  coalesce(x.kimarite_n,0) as kimarite_n,
  case
    when coalesce(w.win_n,0) = 0 then 0
    else 100.0 * coalesce(x.kimarite_n,0) / w.win_n
  end as national_rate
from courses c
cross join kinds k
left join wins w using (course)
left join counts x
  on x.course = c.course
 and x.kimarite = k.kimarite;


-- ----------------------------------------------------------------------------
-- 7. (C) 選手×コースの「勝った時の決まり手」内訳
--    ディリクレ事前分布 α=10
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_win_kimarite_v1 as
with kinds(kimarite) as (
  values ('逃げ'::text),('差し'),('まくり'),('まくり差し'),('抜き'),('恵まれ')
),
cells as (
  select regno, course, count(*) filter (where rank = 1) as win_n
  from public.wake_dictionary_base_24m_v1
  group by regno, course
),
counts as (
  select
    regno,
    course,
    winner_kimarite as kimarite,
    count(*) as kimarite_n
  from public.wake_dictionary_base_24m_v1
  where rank = 1
    and winner_kimarite is not null
  group by regno, course, winner_kimarite
)
select
  c.regno,
  c.course,
  k.kimarite,
  c.win_n,
  coalesce(x.kimarite_n,0) as kimarite_n,
  case
    when c.win_n = 0 then 0
    else 100.0 * coalesce(x.kimarite_n,0) / c.win_n
  end as raw_rate,
  n.national_rate,
  case
    when c.win_n = 0 then 0 - n.national_rate
    else (100.0 * coalesce(x.kimarite_n,0) / c.win_n) - n.national_rate
  end as raw_diff_pt,
  (
    100.0 *
    (
      coalesce(x.kimarite_n,0)
      + 10.0 * (n.national_rate / 100.0)
    )
    / (c.win_n + 10.0)
  ) as adjusted_rate,
  (
    100.0 *
    (
      coalesce(x.kimarite_n,0)
      + 10.0 * (n.national_rate / 100.0)
    )
    / (c.win_n + 10.0)
    - n.national_rate
  ) as adjusted_diff_pt,
  (c.win_n >= 5) as sufficient,
  (
    c.win_n >= 5
    and abs(
      100.0 *
      (
        coalesce(x.kimarite_n,0)
        + 10.0 * (n.national_rate / 100.0)
      )
      / (c.win_n + 10.0)
      - n.national_rate
    ) >= 15.0
  ) as notable
from cells c
cross join kinds k
join public.wake_dictionary_national_win_kimarite_v1 n
  on n.course = c.course
 and n.kimarite = k.kimarite
left join counts x
  on x.regno = c.regno
 and x.course = c.course
 and x.kimarite = k.kimarite;


-- ----------------------------------------------------------------------------
-- 8. (D) 選手×場 成績
--
-- 「本人の全場平均との差」を基準にするため、
-- K=15の縮小先も本人の全場平均率とする。
-- λ = n/(n+15)
-- adjusted = λ*場別率 + (1-λ)*本人全場率
-- ----------------------------------------------------------------------------
create or replace view public.wake_dictionary_venue_stats_v1 as
with all_venue as (
  select
    regno,
    count(*) as all_n,
    100.0 * count(*) filter (where rank = 1) / nullif(count(*),0) as all_win_rate,
    100.0 * count(*) filter (where rank between 1 and 2) / nullif(count(*),0) as all_ren2_rate,
    100.0 * count(*) filter (where rank between 1 and 3) / nullif(count(*),0) as all_ren3_rate,
    avg(st_for_average) as all_avg_st
  from public.wake_dictionary_base_24m_v1
  group by regno
),
venue as (
  select
    regno,
    place_no,
    count(*) as n,
    count(*) filter (where rank = 1) as win_n,
    count(*) filter (where rank between 1 and 2) as ren2_n,
    count(*) filter (where rank between 1 and 3) as ren3_n,
    avg(st_for_average) as avg_st,
    count(*) filter (where is_f) as f_count,
    count(*) filter (where is_l) as l_count,
    100.0 * count(*) filter (where rank = 1) / nullif(count(*),0) as raw_win_rate,
    100.0 * count(*) filter (where rank between 1 and 2) / nullif(count(*),0) as raw_ren2_rate,
    100.0 * count(*) filter (where rank between 1 and 3) / nullif(count(*),0) as raw_ren3_rate
  from public.wake_dictionary_base_24m_v1
  group by regno, place_no
)
select
  v.regno,
  v.place_no,
  v.n,
  v.win_n,
  v.ren2_n,
  v.ren3_n,
  v.avg_st,
  v.f_count,
  v.l_count,
  v.raw_win_rate,
  v.raw_ren2_rate,
  v.raw_ren3_rate,
  a.all_n,
  a.all_win_rate as personal_all_venue_win_rate,
  a.all_ren2_rate as personal_all_venue_ren2_rate,
  a.all_ren3_rate as personal_all_venue_ren3_rate,
  a.all_avg_st as personal_all_venue_avg_st,
  v.raw_win_rate - a.all_win_rate as raw_win_diff_pt,
  v.raw_ren2_rate - a.all_ren2_rate as raw_ren2_diff_pt,
  v.raw_ren3_rate - a.all_ren3_rate as raw_ren3_diff_pt,
  v.n::double precision / (v.n + 15.0) as lambda,
  (
    (v.n::double precision / (v.n + 15.0)) * v.raw_win_rate
    + (15.0 / (v.n + 15.0)) * a.all_win_rate
  ) as adjusted_win_rate,
  (
    (v.n::double precision / (v.n + 15.0)) * v.raw_ren2_rate
    + (15.0 / (v.n + 15.0)) * a.all_ren2_rate
  ) as adjusted_ren2_rate,
  (
    (v.n::double precision / (v.n + 15.0)) * v.raw_ren3_rate
    + (15.0 / (v.n + 15.0)) * a.all_ren3_rate
  ) as adjusted_ren3_rate,
  (
    (v.n::double precision / (v.n + 15.0)) * v.raw_win_rate
    + (15.0 / (v.n + 15.0)) * a.all_win_rate
    - a.all_win_rate
  ) as adjusted_win_diff_pt,
  (
    (v.n::double precision / (v.n + 15.0)) * v.raw_ren2_rate
    + (15.0 / (v.n + 15.0)) * a.all_ren2_rate
    - a.all_ren2_rate
  ) as adjusted_ren2_diff_pt,
  (
    (v.n::double precision / (v.n + 15.0)) * v.raw_ren3_rate
    + (15.0 / (v.n + 15.0)) * a.all_ren3_rate
    - a.all_ren3_rate
  ) as adjusted_ren3_diff_pt
from venue v
join all_venue a using (regno);


-- ----------------------------------------------------------------------------
-- 9. 権限
--    静的生成はservice_roleだけで読む想定。
-- ----------------------------------------------------------------------------
revoke all on public.wake_dictionary_base_24m_v1 from anon, authenticated;
revoke all on public.wake_dictionary_metadata_v1 from anon, authenticated;
revoke all on public.wake_dictionary_racers_v1 from anon, authenticated;
revoke all on public.wake_dictionary_national_course_v1 from anon, authenticated;
revoke all on public.wake_dictionary_course_stats_v1 from anon, authenticated;
revoke all on public.wake_dictionary_national_win_kimarite_v1 from anon, authenticated;
revoke all on public.wake_dictionary_win_kimarite_v1 from anon, authenticated;
revoke all on public.wake_dictionary_venue_stats_v1 from anon, authenticated;

grant select on public.wake_dictionary_base_24m_v1 to service_role;
grant select on public.wake_dictionary_metadata_v1 to service_role;
grant select on public.wake_dictionary_racers_v1 to service_role;
grant select on public.wake_dictionary_national_course_v1 to service_role;
grant select on public.wake_dictionary_course_stats_v1 to service_role;
grant select on public.wake_dictionary_national_win_kimarite_v1 to service_role;
grant select on public.wake_dictionary_win_kimarite_v1 to service_role;
grant select on public.wake_dictionary_venue_stats_v1 to service_role;

select pg_notify('pgrst', 'reload schema');
