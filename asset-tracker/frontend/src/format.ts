import type { DisplayCurrency, HoldingCurrency } from "./types";

type MoneyCcy = DisplayCurrency | HoldingCurrency | "USD" | "CNY" | "HKD";

function ccySymbol(currency: MoneyCcy): string {
  if (currency === "USD") return "$";
  if (currency === "HKD") return "HK$";
  return "¥";
}

/** 持仓明细原币：明确 $ / ¥ / HK$ 前缀 */
export function formatMoney(value: number | null | undefined, currency: MoneyCcy) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const symbol = ccySymbol(currency);
  const locale = currency === "CNY" ? "zh-CN" : "en-US";
  const body = abs.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol}${body}`;
}

export function formatCompact(value: number, currency: DisplayCurrency | HoldingCurrency) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const symbol = ccySymbol(currency);
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

export function formatPct(value: number | null | undefined, withSign = true) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  const sign = withSign && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatQty(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

export function pnlClass(value: number | null | undefined) {
  if (value === null || value === undefined || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

export function currencyTag(currency: MoneyCcy): string {
  if (currency === "USD") return "$";
  if (currency === "HKD") return "HK$";
  return "¥";
}
