-- ============================================================================
-- WAKE辞典 v2.0
-- 「まくられ耐性 / 差され耐性」用の直近1年集計VIEW
--
-- 既存テーブル・既存取込には変更を加えない。
-- 作成するのはWAKE辞典専用VIEWのみ。
--
-- 判定:
--   勝者の進入コース > 対象選手の進入コース
--   対象選手は1着ではない
--   対象選手は有効な着順(2〜6着)を持つ
--   勝者の決まり手が「まくり」→ まくられ
--   勝者の決まり手が「差し」   → 差され
--
-- 「まくり差し」はこの指標には含めない。
--
-- 基準値:
--   単純な全体平均ではなく、対象選手が攻められた時の「内側コース構成」に
--   合わせて全国平均を加重する。
--   例: 1コースで攻められることが多い選手は、1コース被攻撃時の全国平均を
--       多く反映する。
-- ============================================================================

create or replace view public.wake_dictionary_defense_stats_1y_v1 as
with params as (
  select
    ((now() at time zone 'Asia/Tokyo')::date - 1) as period_end,
    (
      ((now() at time zone 'Asia/Tokyo')::date - 1)
      - interval '1 year'
      + interval '1 day'
    )::date as period_start
),
winners as (
  select
    b.race_date,
    b.place_no,
    b.race_no,
    b.course as winner_course,
    b.winner_kimarite
  from public.wake_dictionary_base_24m_v1 b
  cross join params p
  where b.race_date between p.period_start and p.period_end
    and b.rank = 1
    and b.winner_kimarite in ('まくり', '差し')
),
events as (
  select
    v.race_date,
    v.place_no,
    v.race_no,
    v.regno,
    v.course as victim_course,
    v.rank::integer as finish,
    case
      when w.winner_kimarite = 'まくり' then 'まくられ'
      when w.winner_kimarite = '差し' then '差され'
    end as defense_type
  from public.wake_dictionary_base_24m_v1 v
  join winners w
    on w.race_date = v.race_date
   and w.place_no = v.place_no
   and w.race_no = v.race_no
  where v.course < w.winner_course
    and v.rank <> 1
    and v.has_valid_finish
    and v.rank between 2 and 6
),
national_by_course as (
  select
    defense_type,
    victim_course,
    count(*) as n,
    avg(finish::double precision) as avg_finish,
    100.0 * count(*) filter (where finish <= 3) / nullif(count(*), 0) as top3_rate
  from events
  group by defense_type, victim_course
),
racer_agg as (
  select
    e.regno,
    e.defense_type,
    count(*) as n,
    avg(e.finish::double precision) as avg_finish,
    count(*) filter (where e.finish <= 3) as top3_n,
    100.0 * count(*) filter (where e.finish <= 3) / nullif(count(*), 0) as top3_rate,

    -- 各イベントのvictim_courseに対応する全国基準を平均し、
    -- 本人の被攻撃コース構成と同じ重みで基準値を作る。
    avg(n.avg_finish) as baseline_avg_finish,
    avg(n.top3_rate) as baseline_top3_rate
  from events e
  join national_by_course n
    on n.defense_type = e.defense_type
   and n.victim_course = e.victim_course
  group by e.regno, e.defense_type
)
select
  r.regno,
  r.defense_type,
  r.n,
  r.avg_finish,
  r.top3_n,
  r.top3_rate,
  r.baseline_avg_finish,
  r.baseline_top3_rate,
  r.avg_finish - r.baseline_avg_finish as avg_finish_diff,
  r.top3_rate - r.baseline_top3_rate as top3_diff_pt,
  (r.n >= 8) as sufficient,
  p.period_start,
  p.period_end
from racer_agg r
cross join params p;

revoke all on public.wake_dictionary_defense_stats_1y_v1 from anon, authenticated;
grant select on public.wake_dictionary_defense_stats_1y_v1 to service_role;

select pg_notify('pgrst', 'reload schema');
