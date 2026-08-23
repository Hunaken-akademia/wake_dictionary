-- ============================================================================
-- WAKE辞典 v1.3 選手級別・支部 自動取得用
--
-- 既存WAKE本体・既存取込パイプラインは変更しない。
-- 新規のWAKE辞典専用テーブル/VIEWだけを追加する。
-- ============================================================================

create table if not exists public.wake_dictionary_racer_profile_v1 (
  regno integer primary key,
  racer_name text,
  grade text,
  branch text,
  source text not null default 'BOATCAST_STR3',
  source_race_date date,
  source_place_no smallint,
  source_race_no smallint,
  captured_at timestamptz not null default now(),
  constraint wake_dictionary_racer_profile_v1_regno_ck
    check (regno > 0),
  constraint wake_dictionary_racer_profile_v1_grade_ck
    check (grade is null or grade in ('A1','A2','B1','B2'))
);

create index if not exists wake_dictionary_racer_profile_v1_grade_idx
  on public.wake_dictionary_racer_profile_v1 (grade, regno);

create index if not exists wake_dictionary_racer_profile_v1_captured_idx
  on public.wake_dictionary_racer_profile_v1 (captured_at desc);

-- wake_dictionary_base_24m_v1経由だと24ヶ月分・全艇の勝敗判定/除外判定を
-- 一度全展開してからDISTINCT ONで選手ごと1件に絞るため重い(statement timeout
-- 57014の原因になっていた)。「各選手の最新の有効な出走レース1件」だけが
-- 欲しいので、race_results/races/race_results_stagingから直接、選手ごとに
-- 新しい順でレースを見ていき、base_24m_v1と同じ判定(勝者がいる/
-- excluded_from_analysisでない/欠場等でない)を満たす最初の1件で止める形にする。
-- 絞り込み条件・結果はbase_24m_v1経由版と完全に同じ(全1,649件で検証済み)。
create or replace view public.wake_dictionary_racer_profile_seed_v1 as
with params as (
  select
    (now() at time zone 'Asia/Tokyo')::date - 1 as data_end,
    ((now() at time zone 'Asia/Tokyo')::date - 1 - interval '2 years')::date as requested_start
),
regnos as (
  select distinct rr.regno
  from public.race_results rr, params p
  where rr.regno is not null
    and rr.course between 1 and 6
    and rr.race_date >= p.requested_start
    and rr.race_date <= p.data_end
)
select rn.regno, g.race_date, g.place_no, g.race_no
from regnos rn
cross join params p
cross join lateral (
  select rr.race_date, rr.place_no, rr.race_no
  from public.race_results rr
  where rr.regno = rn.regno
    and rr.race_date >= p.requested_start
    and rr.race_date <= p.data_end
    and rr.course between 1 and 6
    and exists (
      select 1 from public.race_results rr2
      where rr2.race_date=rr.race_date and rr2.place_no=rr.place_no and rr2.race_no=rr.race_no and rr2.rank=1
    )
    and not coalesce((
      select bool_or(coalesce(r.excluded_from_analysis,false))
      from public.races r
      where r.race_date=rr.race_date and r.place_no=rr.place_no and r.race_no=rr.race_no
    ), false)
    and not exists (
      select 1 from public.race_results_staging s
      where s.race_date=rr.race_date and s.place_no=rr.place_no and s.race_no=rr.race_no and s.boat_no=rr.boat
        and s.result_status = any(array['ABSENT','SCRATCHED','CANCELLED'])
    )
  order by rr.race_date desc, rr.race_no desc, rr.boat asc
  limit 1
) g;

revoke all on public.wake_dictionary_racer_profile_v1 from anon, authenticated;
revoke all on public.wake_dictionary_racer_profile_seed_v1 from anon, authenticated;

grant select, insert, update on public.wake_dictionary_racer_profile_v1 to service_role;
grant select on public.wake_dictionary_racer_profile_seed_v1 to service_role;

select pg_notify('pgrst', 'reload schema');
