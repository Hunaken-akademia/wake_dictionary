-- WAKE辞典 v1.9
-- 公式BOAT RACE選手プロフィールから取得した読み仮名専用テーブル。
-- 既存テーブルはALTER/DROP/DELETEしない。

create table if not exists public.wake_dictionary_racer_kana_v1 (
  regno integer primary key,
  racer_name text,
  kana_katakana text not null,
  kana_hiragana text not null,
  source text not null default 'BOATRACE_OFFICIAL_PROFILE',
  source_url text not null,
  captured_at timestamptz not null default now(),
  check (regno > 0),
  check (length(kana_katakana) > 0),
  check (length(kana_hiragana) > 0)
);

create index if not exists wake_dictionary_racer_kana_v1_captured_at_idx
  on public.wake_dictionary_racer_kana_v1 (captured_at);

revoke all on table public.wake_dictionary_racer_kana_v1 from anon, authenticated;
grant select, insert, update on table public.wake_dictionary_racer_kana_v1 to service_role;
