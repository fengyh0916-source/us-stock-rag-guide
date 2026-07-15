import type { Dashboard, DisplayCurrency } from "./types";

const PREFIX = "asset-tracker:dashboard:v1:";
/** 缓存最长保留 24 小时，过期后不用于首屏 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CacheEnvelope = {
  savedAt: number;
  data: Dashboard;
};

function key(currency: DisplayCurrency) {
  return `${PREFIX}${currency}`;
}

export function readDashboardCache(currency: DisplayCurrency): Dashboard | null {
  try {
    const raw = localStorage.getItem(key(currency));
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env?.data || typeof env.savedAt !== "number") return null;
    if (Date.now() - env.savedAt > MAX_AGE_MS) return null;
    return env.data;
  } catch {
    return null;
  }
}

export function writeDashboardCache(currency: DisplayCurrency, data: Dashboard) {
  try {
    const env: CacheEnvelope = { savedAt: Date.now(), data };
    localStorage.setItem(key(currency), JSON.stringify(env));
  } catch {
    /* quota / private mode */
  }
}

export function cacheAgeLabel(currency: DisplayCurrency): string | null {
  try {
    const raw = localStorage.getItem(key(currency));
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env?.savedAt) return null;
    const sec = Math.round((Date.now() - env.savedAt) / 1000);
    if (sec < 5) return "刚刚";
    if (sec < 60) return `${sec}秒前`;
    if (sec < 3600) return `${Math.round(sec / 60)}分钟前`;
    return `${Math.round(sec / 3600)}小时前`;
  } catch {
    return null;
  }
}
