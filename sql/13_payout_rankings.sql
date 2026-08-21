-- WAKE辞典 配当ランキング素材
-- 2025年は配当の保存率が不十分なため、保存率が安定した2026-02-01以降だけを使う。
-- コースは艇番ではなく race_results.course（実進入）を使用する。

create or replace view public.wake_dictionary_payout_course_v1 as
select
  rr.regno,
  rr.course,
  count(*)::bigint as starts,
  count(*) filter (where rp.trifecta_payout_per_100 >= 10000)::bigint
    as manbune_starts,
  count(*) filter (where rr.rank between 1 and 3)::bigint
    as top3_finishes,
  count(*) filter (
    where rr.rank between 1 and 3
      and rp.trifecta_payout_per_100 >= 10000
  )::bigint as manbune_top3,
  sum(rp.trifecta_payout_per_100)::bigint as payout_sum,
  round(avg(rp.trifecta_payout_per_100))::bigint as avg_payout,
  max(rp.trifecta_payout_per_100)::integer as max_payout,
  min(rr.race_date) as first_race_date,
  max(rr.race_date) as last_race_date
from public.race_results rr
join public.race_payouts rp
  using (race_date, place_no, race_no)
where rr.race_date >= date '2026-02-01'
  and rr.course between 1 and 6
  and rr.rank between 1 and 6
  and rp.trifecta_payout_per_100 > 0
group by rr.regno, rr.course;

comment on view public.wake_dictionary_payout_course_v1 is
  '2026-02-01以降の実進入コース別3連単配当集計。WAKE辞典の無補正ランキング用。';

grant select on public.wake_dictionary_payout_course_v1 to service_role;
