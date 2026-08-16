-- ============================================================================
-- WAKE辞典 v2.3
-- 場 × コース × 決まり手 差分キャッシュ
--
-- 目的:
--   24場フィルターを「その場での過去成績」に対して正確に使う。
--   毎朝1649人を再集計せず、v2.1で抽出した差分対象選手だけ更新する。
--
-- 安全性:
--   既存テーブルへの DELETE / TRUNCATE / DROP / ALTER は行わない。
--   新規WAKE辞典専用テーブル・関数・検索用INDEXのみ追加。
-- ============================================================================

create table if not exists public.wake_dictionary_venue_course_cache_v1 (
  regno integer primary key,
  rows jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now(),
  data_end date,
  period_start_24m date
);

create index if not exists wake_dict_vc_cache_data_end_idx
  on public.wake_dictionary_venue_course_cache_v1 (data_end);

-- 対象選手の24ヶ月データを先に絞るための索引。
create index if not exists wake_dict_rr_regno_date_place_course_idx
  on public.race_results (regno, race_date, place_no, course);

-- 同一レースに1着艇が存在するかを高速確認。
create index if not exists wake_dict_rr_race_rank_idx
  on public.race_results (race_date, place_no, race_no, rank);

-- stagingの非出走/F/L判定用。
create index if not exists wake_dict_staging_race_boat_idx
  on public.race_results_staging (race_date, place_no, race_no, boat_no);

create index if not exists wake_dict_races_key_excluded_v23_idx
  on public.races (race_date, place_no, race_no, excluded_from_analysis);


create or replace function public.wake_dictionary_venue_course_stats_for_racers_v1(
  p_regnos integer[]
)
returns table (
  regno integer,
  place_no integer,
  course integer,
  n bigint,
  win_n bigint,
  ren2_n bigint,
  ren3_n bigint,
  avg_st double precision,
  f_count bigint,
  l_count bigint,
  st_missing_count bigint,
  nige_n bigint,
  sashi_n bigint,
  makuri_n bigint,
  makurizashi_n bigint,
  nuki_n bigint,
  megumare_n bigint
)
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select
    ((now() at time zone 'Asia/Tokyo')::date - 1) as data_end,
    (
      ((now() at time zone 'Asia/Tokyo')::date - 1)
      - interval '24 months'
    )::date as period_start
),
subject as (
  select
    rr.race_date,
    rr.place_no,
    rr.race_no,
    rr.boat,
    rr.course,
    rr.regno,
    rr.rank,
    rr.kimarite,
    rr.st,
    rr.is_f,
    s.result_status,
    case
      when s.result_status = 'F' then true
      when coalesce(rr.is_f, false) then true
      when rr.st < 0 then true
      else false
    end as is_f_norm,
    case when s.result_status = 'L' then true else false end as is_l_norm
  from public.race_results rr
  cross join params p
  left join public.race_results_staging s
    on s.race_date = rr.race_date
   and s.place_no = rr.place_no
   and s.race_no = rr.race_no
   and s.boat_no = rr.boat
  left join public.races r
    on r.race_date = rr.race_date
   and r.place_no = rr.place_no
   and r.race_no = rr.race_no
  where rr.regno = any(p_regnos)
    and rr.race_date between p.period_start and p.data_end
    and rr.course between 1 and 6
    and not coalesce(r.excluded_from_analysis, false)
    and coalesce(s.result_status, '') not in ('ABSENT','SCRATCHED','CANCELLED')
    and exists (
      select 1
      from public.race_results w
      where w.race_date = rr.race_date
        and w.place_no = rr.place_no
        and w.race_no = rr.race_no
        and w.rank = 1
    )
)
select
  x.regno,
  x.place_no,
  x.course,
  count(*)::bigint as n,
  count(*) filter (where x.rank = 1)::bigint as win_n,
  count(*) filter (where x.rank between 1 and 2)::bigint as ren2_n,
  count(*) filter (where x.rank between 1 and 3)::bigint as ren3_n,
  avg(
    case
      when x.is_f_norm or x.is_l_norm then null
      when x.st is null or x.st < 0 then null
      else x.st::double precision
    end
  ) as avg_st,
  count(*) filter (where x.is_f_norm)::bigint as f_count,
  count(*) filter (where x.is_l_norm)::bigint as l_count,
  count(*) filter (
    where not x.is_f_norm
      and not x.is_l_norm
      and (x.st is null or x.st < 0)
  )::bigint as st_missing_count,
  count(*) filter (where x.rank = 1 and x.kimarite = '逃げ')::bigint as nige_n,
  count(*) filter (where x.rank = 1 and x.kimarite = '差し')::bigint as sashi_n,
  count(*) filter (where x.rank = 1 and x.kimarite = 'まくり')::bigint as makuri_n,
  count(*) filter (where x.rank = 1 and x.kimarite = 'まくり差し')::bigint as makurizashi_n,
  count(*) filter (where x.rank = 1 and x.kimarite = '抜き')::bigint as nuki_n,
  count(*) filter (where x.rank = 1 and x.kimarite = '恵まれ')::bigint as megumare_n
from subject x
group by x.regno, x.place_no, x.course
order by x.regno, x.place_no, x.course
$$;

revoke all on public.wake_dictionary_venue_course_cache_v1 from anon, authenticated;
grant select, insert, update on public.wake_dictionary_venue_course_cache_v1 to service_role;

revoke all on function public.wake_dictionary_venue_course_stats_for_racers_v1(integer[])
  from public, anon, authenticated;
grant execute on function public.wake_dictionary_venue_course_stats_for_racers_v1(integer[])
  to service_role;

select pg_notify('pgrst', 'reload schema');
