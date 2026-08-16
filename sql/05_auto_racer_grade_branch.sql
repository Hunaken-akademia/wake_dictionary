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

create or replace view public.wake_dictionary_racer_profile_seed_v1 as
select distinct on (b.regno)
  b.regno,
  b.race_date,
  b.place_no,
  b.race_no
from public.wake_dictionary_base_24m_v1 b
where b.regno is not null
order by
  b.regno,
  b.race_date desc,
  b.race_no desc,
  b.boat;

revoke all on public.wake_dictionary_racer_profile_v1 from anon, authenticated;
revoke all on public.wake_dictionary_racer_profile_seed_v1 from anon, authenticated;

grant select, insert, update on public.wake_dictionary_racer_profile_v1 to service_role;
grant select on public.wake_dictionary_racer_profile_seed_v1 to service_role;

select pg_notify('pgrst', 'reload schema');
