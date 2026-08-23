-- WAKE辞典 展示ST×本番STシンクロ率ランキング素材
--
-- 「シンクロ率」は、展示走行のST(exhibition.st)と本番レースのST(race_results.st)の
-- 差が小さい(=展示どおりのSTを本番でも出せている)レースがどれだけあるかを示す指標。
-- |差|<=0.02秒を一致とみなす。
--
-- 本番STがフライング(is_f=true)のレースは、展示STとの単純な差では比較できないため除外する。
-- exhibition.stは2025年後半以降のみ保存されているため、集計対象は自動的にその期間からになる。

create or replace view public.wake_dictionary_st_sync_v1 as
select
  rr.regno,
  count(*)::bigint as n,
  count(*) filter (where abs(rr.st - e.st) <= 0.02)::bigint as sync_n,
  round(avg(abs(rr.st - e.st))::numeric, 4) as avg_abs_diff,
  round(avg(e.st)::numeric, 4) as avg_exhibition_st,
  round(avg(rr.st)::numeric, 4) as avg_actual_st,
  min(rr.race_date) as first_race_date,
  max(rr.race_date) as last_race_date
from public.race_results rr
join public.exhibition e
  on e.race_date = rr.race_date
  and e.place_no = rr.place_no
  and e.race_no = rr.race_no
  and e.boat = rr.boat
where rr.st is not null
  and rr.rank between 1 and 6
  and coalesce(rr.is_f, false) = false
  and e.st is not null
group by rr.regno;

comment on view public.wake_dictionary_st_sync_v1 is
  '展示STと本番STの差(|差|<=0.02秒を一致とみなす)から算出するシンクロ率。WAKE辞典のランキング用。';

grant select on public.wake_dictionary_st_sync_v1 to service_role;
