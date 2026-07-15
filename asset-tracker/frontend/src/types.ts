export type Market = "us" | "cn" | "cash";
export type DisplayCurrency = "USD" | "CNY";
/** 持仓原币：含港币现金 */
export type HoldingCurrency = "USD" | "CNY" | "HKD";
export type AssetType = "stock" | "etf" | "fund" | "cash";

export interface PortfolioSummary {
  id: number | "all";
  name: string;
  market?: Market | null;
  sort_order?: number;
  market_value: number;
  cost_value: number;
  pnl: number;
  pnl_pct: number | null;
  holding_count: number;
}

export interface HoldingRow {
  id: number;
  portfolio_id: number;
  asset_type: AssetType;
  symbol: string;
  name: string;
  quantity: number;
  cost_price: number;
  market: Market;
  currency: HoldingCurrency;
  sort_order?: number;
  /** 固定盈亏修正（元），不改成本价 */
  pnl_adjustment?: number;
  price: number | null;
  /** 美股：pre 盘前 / regular 常规 / post 盘后 */
  price_session?: "pre" | "regular" | "post" | null;
  market_value: number | null;
  cost_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  weight: number | null;
  quote_date?: string | null;
  quote_error?: string | null;
}

export interface Dashboard {
  display_currency: DisplayCurrency;
  fx_rate: number;
  fx_date: string | null;
  fx_source: string;
  total_market_value: number;
  total_cost_value: number;
  total_pnl: number;
  total_pnl_pct: number | null;
  portfolios: PortfolioSummary[];
  holdings: HoldingRow[];
  updated_at: string;
  cn_open: boolean;
  us_open: boolean;
  any_open: boolean;
  poll_seconds: number;
}
