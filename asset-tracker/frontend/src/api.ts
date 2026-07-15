import type { AssetType, Dashboard, DisplayCurrency, Market } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 401) {
    // 会话失效：回到站点门禁页重新登录
    if (typeof window !== "undefined") {
      window.location.href = "/tools/asset-tracker";
    }
    throw new Error("请先登录后再使用资产管理");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.detail || body.message || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof msg === "string" ? msg : "请求失败");
  }
  return res.json() as Promise<T>;
}

export function fetchDashboard(params: {
  portfolioId?: number | "all";
  displayCurrency: DisplayCurrency;
  forceRefresh?: boolean;
}) {
  const q = new URLSearchParams();
  if (params.portfolioId !== undefined && params.portfolioId !== "all") {
    q.set("portfolio_id", String(params.portfolioId));
  }
  q.set("display_currency", params.displayCurrency);
  if (params.forceRefresh) q.set("force_refresh", "true");
  return request<Dashboard>(`/api/dashboard?${q.toString()}`);
}

export function createPortfolio(name: string, market: Market) {
  return request("/api/portfolios", {
    method: "POST",
    body: JSON.stringify({ name, market }),
  });
}

export function deletePortfolio(id: number) {
  return request(`/api/portfolios/${id}`, { method: "DELETE" });
}

export function createHolding(body: {
  portfolio_id: number;
  asset_type: AssetType;
  symbol?: string;
  name?: string;
  quantity: number;
  cost_price?: number;
  currency?: "USD" | "CNY" | "HKD";
}) {
  return request("/api/holdings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateHolding(
  id: number,
  body: {
    quantity?: number;
    cost_price?: number;
    name?: string;
    pnl_adjustment?: number;
  },
) {
  return request(`/api/holdings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteHolding(id: number) {
  return request(`/api/holdings/${id}`, { method: "DELETE" });
}

export function seedDemo() {
  return request<{
    ok: boolean;
    message: string;
    action?: "cleared" | "seeded";
    has_data?: boolean;
  }>("/api/seed-demo", {
    method: "POST",
  });
}

export function fetchDataStatus() {
  return request<{ has_data: boolean; portfolio_count: number }>("/api/data-status");
}

export type PerformanceRange = "1m" | "3m" | "6m" | "1y";

export type PerformancePoint = {
  date: string;
  value: number;
  /** 相对区间首日的累计收益率，如 0.05 = +5% */
  return_pct?: number;
};

export type PerformanceResponse = {
  range: PerformanceRange;
  display_currency: DisplayCurrency;
  method: string;
  method_label: string;
  points: PerformancePoint[];
  start_value: number | null;
  end_value: number | null;
  cost_basis?: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  /** 相对持仓成本的浮盈比例 */
  vs_cost_pct?: number | null;
  fx_date?: string | null;
  message?: string | null;
  note?: string | null;
  formula?: {
    daily_value?: string;
    period_return?: string;
    assumption?: string;
  };
};

export function fetchPerformance(params: {
  range: PerformanceRange;
  displayCurrency: DisplayCurrency;
}) {
  const q = new URLSearchParams({
    range: params.range,
    display_currency: params.displayCurrency,
  });
  return request<PerformanceResponse>(`/api/performance?${q.toString()}`);
}

export function reorderPortfolios(ids: number[]) {
  return request("/api/portfolios/reorder", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

export function reorderHoldings(ids: number[]) {
  return request("/api/holdings/reorder", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

export function renamePortfolio(id: number, name: string) {
  return request(`/api/portfolios/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export type IbSyncResult = {
  ok: boolean;
  message?: string;
  synced?: number;
  created?: number;
  updated?: number;
  count?: number;
  priced_count?: number;
  price_source_summary?: string;
  positions?: Array<{
    symbol: string;
    quantity: number;
    avg_cost: number;
    market_price?: number | null;
    price_from?: string;
  }>;
  errors?: string[];
  host?: string;
  port?: number;
};

export function syncIbHoldings(portfolioId: number, replace = false) {
  const q = new URLSearchParams({
    portfolio_id: String(portfolioId),
    replace: String(replace),
  });
  return request<IbSyncResult>(`/api/ib/sync?${q.toString()}`, { method: "POST" });
}

export function fetchIbStatus() {
  return request<{
    host: string;
    port: number;
    port_open: boolean;
    error?: string | null;
    hint?: string | null;
  }>("/api/ib/status");
}
