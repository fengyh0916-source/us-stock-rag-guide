-- 在 Supabase SQL Editor 中执行本文件
-- 个人资产管理看板 · 数据表

create table if not exists public.portfolios (
  id bigserial primary key,
  user_id varchar(64) not null,
  name varchar(20) not null,
  market varchar(10) not null check (market in ('us', 'cn', 'cash')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holdings (
  id bigserial primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  asset_type varchar(10) not null check (asset_type in ('stock', 'etf', 'fund', 'cash')),
  symbol varchar(32) not null,
  name varchar(64) not null default '',
  currency varchar(8) not null default 'CNY' check (currency in ('USD', 'CNY', 'HKD')),
  quantity double precision not null,
  cost_price double precision not null,
  pnl_adjustment double precision not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, symbol)
);

create index if not exists idx_holdings_portfolio on public.holdings (portfolio_id);
create index if not exists idx_portfolios_user on public.portfolios (user_id);

-- 个人自用：先用 service role / 后端直连，关闭匿名匿名访问
alter table public.portfolios enable row level security;
alter table public.holdings enable row level security;

revoke all on table public.portfolios from public, anon, authenticated;
revoke all on table public.holdings from public, anon, authenticated;
grant all on table public.portfolios to service_role;
grant all on table public.holdings to service_role;

comment on table public.portfolios is '投资组合（美股/A股/现金）';
comment on table public.holdings is '持仓明细';
