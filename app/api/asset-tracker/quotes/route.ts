import { NextResponse } from "next/server";
import { stocks } from "stock-api";

import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import { getUserFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRequest = {
  codes?: unknown;
};

type ExtendedQuote = {
  price: number;
  source: string;
};

function pickCurrentUsPrice(meta: any): ExtendedQuote | null {
  const periods = meta?.currentTradingPeriod;
  const now = Math.floor(Date.now() / 1000);
  const session = periods?.pre && now >= periods.pre.start && now < periods.pre.end
    ? "pre"
    : periods?.regular && now >= periods.regular.start && now < periods.regular.end
      ? "regular"
      : periods?.post && now >= periods.post.start && now < periods.post.end
        ? "post"
        : "closed";

  const prices = {
    pre: { price: meta.preMarketPrice, source: "盘前" },
    regular: { price: meta.regularMarketPrice, source: "stock-api" },
    post: { price: meta.postMarketPrice, source: "盘后" }
  };
  const selected = prices[session as keyof typeof prices];

  if (selected && Number.isFinite(selected.price) && selected.price > 0) {
    return selected;
  }

  const regular = prices.regular;
  return Number.isFinite(regular.price) && regular.price > 0 ? regular : null;
}

async function getUsExtendedQuotes(codes: string[]) {
  const entries = await Promise.all(codes.map(async (code): Promise<[string, ExtendedQuote] | null> => {
    const symbol = code.slice(2);
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`,
        {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000)
        }
      );
      if (!response.ok) return null;

      const payload = await response.json();
      const meta = payload?.chart?.result?.[0]?.meta;
      if (!meta) return null;

      const current = pickCurrentUsPrice(meta);
      return current ? [code, current] : null;
    } catch {
      return null;
    }
  }));

  return new Map(entries.filter((entry): entry is [string, ExtendedQuote] => entry !== null));
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const limited = rateLimit({
    key: `quotes:${user.id}:${clientIpFromRequest(request)}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "行情查询过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let body: QuoteRequest;

  try {
    body = (await request.json()) as QuoteRequest;
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const codes = Array.isArray(body.codes)
    ? [...new Set(body.codes.filter((code): code is string => typeof code === "string").map((code) => code.trim().toUpperCase()).filter(Boolean))]
    : [];

  if (codes.length === 0) {
    return NextResponse.json({ quotes: [] });
  }

  if (codes.length > 50) {
    return NextResponse.json({ error: "单次最多查询 50 个标的" }, { status: 400 });
  }

  try {
    const result = await stocks.auto.getStocks(codes);
    const extendedQuotes = await getUsExtendedQuotes(codes.filter((code) => code.startsWith("US")));
    const quotes = result
      .filter((quote) => Number.isFinite(quote.now) && quote.now > 0)
      .map((quote) => {
        const extended = extendedQuotes.get(quote.code);
        const price = extended?.price ?? quote.now;
        return {
          code: quote.code,
          name: quote.name,
          price,
          previousClose: quote.yesterday,
          changePercent: quote.yesterday > 0 ? price / quote.yesterday - 1 : quote.percent,
          source: extended?.source ?? quote.source ?? "stock-api"
        };
      });

    return NextResponse.json({ quotes });
  } catch (error) {
    console.error("Failed to load stock quotes", error);
    return NextResponse.json({ error: "实时行情暂时不可用" }, { status: 502 });
  }
}
