-- ============================================================================
-- WAKE辞典 v2.1 差分更新キャッシュ
--
-- 目的:
--   毎朝、全選手の重い集計VIEWを再取得しない。
--   前日走った選手 / 集計窓から古いレースが抜ける選手 / 新規選手だけを
--   再取得し、WAKE辞典専用キャッシュに保存する。
--
-- 安全性:
--   既存テーブルのDROP / TRUNCATE / DELETE / ALTERは行わない。
--   新規テーブル・新規VIEW・検索用INDEXのみ追加。
-- ============================================================================

create table if not exists public.wake_dictionary_incremental_cache_v1 (
  regno integer primary key,
  racer_name text,
  course_rows jsonb not null default '[]'::jsonb,
  venue_rows jsonb not null default '[]'::jsonb,
  kimarite_rows jsonb not null default '[]'::jsonb,
  defense_rows jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now(),
  data_end date,
  period_start_24m date,
  defense_start_1y date
);

create table if not exists public.wake_dictionary_incremental_state_v1 (
  id integer primary key check (id = 1),
  last_data_end date,
  period_start_24m date,
  defense_start_1y date,
  raw_rows bigint,
  updated_at timestamptz not null default now()
);

create index if not exists wake_dict_cache_data_end_idx
  on public.wake_dictionary_incremental_cache_v1 (data_end);

-- 差分対象選手を日付で拾うための索引。
create index if not exists wake_dict_rr_date_regno_idx
  on public.race_results (race_date, regno);

create index if not exists wake_dict_rr_created_regno_idx
  on public.race_results (created_at, regno);

-- defense raw VIEWを選手単位で軽く読むための索引。
create index if not exists wake_dict_rr_regno_date_course_idx
  on public.race_results (regno, race_date, course);

create index if not exists wake_dict_rr_race_key_rank_idx
  on public.race_results (race_date, place_no, race_no, rank);

-- --------------------------------------------------------------------------
-- まくられ / 差され の「生イベント集計」
-- 全国基準はNode側で全キャッシュから再計算する。
-- これにより、毎朝全選手のdefense VIEWを再取得する必要がない。
-- --------------------------------------------------------------------------
create or replace view public.wake_dictionary_defense_raw_1y_v1 as
with params as (
  select
    ((now() at time zone 'Asia/Tokyo')::date - 1) as period_end,
    (
      ((now() at time zone 'Asia/Tokyo')::date - 1)
      - interval '1 year'
      + interval '1 day'
    )::date as period_start
),
attack_winners as (
  select
    w.race_date,
    w.place_no,
    w.race_no,
    w.course as winner_course,
    w.kimarite as winner_kimarite
  from public.race_results w
  cross join params p
  left join public.races r
    on r.race_date = w.race_date
   and r.place_no = w.place_no
   and r.race_no = w.race_no
  where w.race_date between p.period_start and p.period_end
    and w.rank = 1
    and w.course between 1 and 6
    and w.kimarite in ('まくり', '差し')
    and not coalesce(r.excluded_from_analysis, false)
),
events as (
  select
    v.regno,
    v.course as victim_course,
    v.rank::integer as finish,
    case
      when w.winner_kimarite = 'まくり' then 'まくられ'
      when w.winner_kimarite = '差し' then '差され'
    end as defense_type
  from attack_winners w
  join public.race_results v
    on v.race_date = w.race_date
   and v.place_no = w.place_no
   and v.race_no = w.race_no
  where v.regno is not null
    and v.course between 1 and 6
    and v.course < w.winner_course
    and v.rank between 2 and 6
)
select
  e.regno,
  e.defense_type,
  e.victim_course,
  count(*)::bigint as n,
  sum(e.finish)::bigint as finish_sum,
  count(*) filter (where e.finish <= 3)::bigint as top3_n,
  p.period_start,
  p.period_end
from events e
cross join params p
group by
  e.regno,
  e.defense_type,
  e.victim_course,
  p.period_start,
  p.period_end;

revoke all on public.wake_dictionary_incremental_cache_v1 from anon, authenticated;
revoke all on public.wake_dictionary_incremental_state_v1 from anon, authenticated;
revoke all on public.wake_dictionary_defense_raw_1y_v1 from anon, authenticated;

grant select, insert, update on public.wake_dictionary_incremental_cache_v1 to service_role;
grant select, insert, update on public.wake_dictionary_incremental_state_v1 to service_role;
grant select on public.wake_dictionary_defense_raw_1y_v1 to service_role;

select pg_notify('pgrst', 'reload schema');
