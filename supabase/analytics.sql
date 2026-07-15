-- 产品行为分析：仅存储匿名标识与结构化指标，不存问题原文、邮箱或持仓。
-- 在 Supabase SQL Editor 执行；应用仅使用 service_role 写入和读取聚合结果。

create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_name text not null check (char_length(event_name) between 1 and 80),
  actor_type text not null check (actor_type in ('guest', 'user')),
  actor_key text not null check (char_length(actor_key) = 64),
  page_type text,
  page_slug text,
  source text,
  intent text,
  provider text,
  status text,
  error_code text,
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 300000),
  retrieval_count integer check (retrieval_count is null or retrieval_count between 0 and 100),
  related_count integer check (related_count is null or related_count between 0 and 100),
  helpful boolean
);

create index if not exists idx_product_events_occurred_at
  on public.product_events (occurred_at desc);
create index if not exists idx_product_events_name_time
  on public.product_events (event_name, occurred_at desc);
create index if not exists idx_product_events_actor_time
  on public.product_events (actor_key, occurred_at desc);
create index if not exists idx_product_events_page_time
  on public.product_events (event_name, page_slug, occurred_at desc);

alter table public.product_events enable row level security;
revoke all on table public.product_events from public, anon, authenticated;
grant all on table public.product_events to service_role;

comment on table public.product_events is
  'Privacy-safe product analytics. actor_key is an HMAC pseudonym; raw questions, emails, IPs and holdings are never stored.';

create or replace function public.analytics_dashboard(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90))) as since
  ),
  base as (
    select e.*
    from public.product_events e, params p
    where e.occurred_at >= p.since
  ),
  summary as (
    select
      count(*)::bigint as total_events,
      count(distinct actor_key)::bigint as active_actors,
      count(*) filter (where event_name = 'page_view')::bigint as page_views,
      count(distinct actor_key) filter (where event_name = 'page_view')::bigint as visitors,
      count(*) filter (
        where event_name = 'page_view'
          and occurred_at >= date_trunc('day', now())
      )::bigint as today_page_views,
      count(distinct actor_key) filter (
        where event_name = 'page_view'
          and occurred_at >= date_trunc('day', now())
      )::bigint as today_visitors,
      count(*) filter (where event_name = 'agent_opened')::bigint as agent_opens,
      count(*) filter (where event_name = 'question_submitted')::bigint as questions,
      count(*) filter (where event_name = 'answer_succeeded')::bigint as answer_successes,
      count(*) filter (where event_name = 'answer_failed')::bigint as answer_failures,
      count(*) filter (where event_name = 'related_article_clicked')::bigint as related_clicks,
      count(*) filter (where event_name = 'signup_completed')::bigint as signups,
      count(*) filter (where event_name = 'checkin_completed')::bigint as checkins,
      count(*) filter (where event_name = 'feedback_submitted')::bigint as feedback_total,
      count(*) filter (where event_name = 'feedback_submitted' and helpful is true)::bigint as helpful_feedback,
      round(avg(latency_ms) filter (where event_name = 'answer_succeeded'))::bigint as avg_latency_ms,
      round(percentile_cont(0.95) within group (order by latency_ms)
        filter (where event_name = 'answer_succeeded' and latency_ms is not null))::bigint as p95_latency_ms
    from base
  ),
  daily as (
    select
      occurred_at::date as day,
      count(distinct actor_key)::bigint as active_actors,
      count(*) filter (where event_name = 'page_view')::bigint as page_views,
      count(distinct actor_key) filter (where event_name = 'page_view')::bigint as visitors,
      count(*) filter (where event_name = 'question_submitted')::bigint as questions,
      count(*) filter (where event_name = 'answer_succeeded')::bigint as successes,
      count(*) filter (where event_name = 'answer_failed')::bigint as failures
    from base
    group by occurred_at::date
    order by day
  ),
  event_counts as (
    select event_name, count(*)::bigint as count
    from base
    group by event_name
    order by count desc, event_name
  ),
  top_pages as (
    select
      coalesce(nullif(page_slug, ''), '/') as page,
      count(*)::bigint as page_views,
      count(distinct actor_key)::bigint as visitors
    from base
    where event_name = 'page_view'
    group by coalesce(nullif(page_slug, ''), '/')
    order by page_views desc, visitors desc, page
    limit 8
  )
  select jsonb_build_object(
    'summary', coalesce((select to_jsonb(summary) from summary), '{}'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily), '[]'::jsonb),
    'top_pages', coalesce((select jsonb_agg(to_jsonb(top_pages) order by page_views desc, visitors desc) from top_pages), '[]'::jsonb),
    'event_counts', coalesce((select jsonb_agg(to_jsonb(event_counts) order by count desc) from event_counts), '[]'::jsonb)
  );
$$;

revoke all on function public.analytics_dashboard(integer) from public, anon, authenticated;
grant execute on function public.analytics_dashboard(integer) to service_role;
