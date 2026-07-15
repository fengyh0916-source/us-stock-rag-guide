-- Public deployment prerequisites for account verification and atomic chat quota.
-- Run in Supabase SQL Editor. Supabase Auth itself is managed by auth.users.

create table if not exists public.chat_daily_quotas (
  day date not null,
  subject_type text not null check (subject_type in ('guest', 'user')),
  subject_id text not null,
  used integer not null default 0 check (used >= 0),
  allowance integer not null default 0 check (allowance >= 0),
  checked_in boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (day, subject_type, subject_id)
);

alter table public.chat_daily_quotas enable row level security;
revoke all on table public.chat_daily_quotas from public, anon, authenticated;
grant all on table public.chat_daily_quotas to service_role;

create or replace function public.consume_guest_chat(
  p_day date,
  p_subject_id text,
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r chat_daily_quotas%rowtype;
begin
  insert into chat_daily_quotas(day, subject_type, subject_id)
  values (p_day, 'guest', p_subject_id)
  on conflict do nothing;
  select * into r from chat_daily_quotas
  where day=p_day and subject_type='guest' and subject_id=p_subject_id for update;
  if r.used >= p_limit then
    return jsonb_build_object('ok', false, 'code', 'GUEST_LIMIT', 'used', r.used, 'limit', p_limit);
  end if;
  update chat_daily_quotas set used=used+1, updated_at=now()
  where day=p_day and subject_type='guest' and subject_id=p_subject_id returning * into r;
  return jsonb_build_object('ok', true, 'used', r.used, 'limit', p_limit, 'remaining', p_limit-r.used);
end $$;

create or replace function public.consume_user_chat(p_day date, p_subject_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r chat_daily_quotas%rowtype;
begin
  select * into r from chat_daily_quotas
  where day=p_day and subject_type='user' and subject_id=p_subject_id for update;
  if not found or not r.checked_in or r.allowance <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NEED_CHECKIN', 'used', coalesce(r.used,0), 'allowance', coalesce(r.allowance,0), 'checkedIn', false);
  end if;
  if r.used >= r.allowance then
    return jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED', 'used', r.used, 'allowance', r.allowance, 'checkedIn', true);
  end if;
  update chat_daily_quotas set used=used+1, updated_at=now()
  where day=p_day and subject_type='user' and subject_id=p_subject_id returning * into r;
  return jsonb_build_object('ok', true, 'used', r.used, 'allowance', r.allowance, 'remaining', r.allowance-r.used);
end $$;

create or replace function public.refund_chat(
  p_day date,
  p_subject_type text,
  p_subject_id text
) returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  update chat_daily_quotas set used=greatest(used-1,0), updated_at=now()
  where day=p_day and subject_type=p_subject_type and subject_id=p_subject_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.daily_chat_check_in(
  p_day date,
  p_subject_id text,
  p_reward integer
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare r chat_daily_quotas%rowtype;
begin
  insert into chat_daily_quotas(day, subject_type, subject_id, used, allowance, checked_in)
  values (p_day, 'user', p_subject_id, 0, p_reward, true)
  on conflict do nothing
  returning * into r;
  if found then
    return jsonb_build_object('ok', true, 'already', false, 'allowance', r.allowance, 'reward', p_reward);
  end if;
  select * into r from chat_daily_quotas
  where day=p_day and subject_type='user' and subject_id=p_subject_id for update;
  return jsonb_build_object('ok', true, 'already', true, 'used', r.used, 'allowance', r.allowance, 'remaining', greatest(r.allowance-r.used,0));
end $$;

revoke all on function public.consume_guest_chat(date,text,integer) from public, anon, authenticated;
revoke all on function public.consume_user_chat(date,text) from public, anon, authenticated;
revoke all on function public.refund_chat(date,text,text) from public, anon, authenticated;
revoke all on function public.daily_chat_check_in(date,text,integer) from public, anon, authenticated;
grant execute on function public.consume_guest_chat(date,text,integer) to service_role;
grant execute on function public.consume_user_chat(date,text) to service_role;
grant execute on function public.refund_chat(date,text,text) to service_role;
grant execute on function public.daily_chat_check_in(date,text,integer) to service_role;
