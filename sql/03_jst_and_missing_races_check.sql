-- WAKE辞典 v1.1 JST修正後確認（SELECTのみ）

-- 1) metadata: generated_on がJSTの当日になっていること
select * from public.wake_dictionary_metadata_v1;

-- 2) raw race にあるが base から消えたレースの内訳確認
with params as (
  select
    (now() at time zone 'Asia/Tokyo')::date as generated_on,
    ((now() at time zone 'Asia/Tokyo')::date - interval '24 months')::date as requested_start
),
raw_races as (
  select
    rr.race_date, rr.place_no, rr.race_no,
    bool_or(rr.rank = 1) as has_winner,
    count(*) as raw_rows,
    count(*) filter (where rr.regno is null) as regno_null_rows,
    count(*) filter (where rr.course not between 1 and 6 or rr.course is null) as bad_course_rows,
    coalesce(bool_or(coalesce(r.excluded_from_analysis,false)),false) as excluded_flag
  from public.race_results rr
  cross join params p
  left join public.races r
    on r.race_date=rr.race_date and r.place_no=rr.place_no and r.race_no=rr.race_no
  where rr.race_date between p.requested_start and p.generated_on
  group by rr.race_date, rr.place_no, rr.race_no
),
base_races as (
  select race_date, place_no, race_no, count(*) as usable_rows
  from public.wake_dictionary_base_24m_v1
  group by race_date, place_no, race_no
)
select
  rr.*,
  coalesce(br.usable_rows,0) as usable_rows
from raw_races rr
left join base_races br using (race_date, place_no, race_no)
where br.race_date is null
order by rr.race_date desc, rr.place_no, rr.race_no
limit 300;
