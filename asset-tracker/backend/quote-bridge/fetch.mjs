#!/usr/bin/env node
/**
 * stock-api 桥接：读取代码列表，输出统一 JSON。
 * 用法: node fetch.mjs USNVDA,SH600519,SZ000651
 * 或 stdin 一行 codes
 */
import { stocks } from "stock-api";

async function main() {
  const arg = process.argv[2] || "";
  const codes = arg
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (!codes.length) {
    console.log(JSON.stringify({ ok: false, error: "no codes", quotes: [] }));
    process.exit(1);
  }

  try {
    const rows = await stocks.auto.getStocks(codes);
    const quotes = (rows || []).map((row) => ({
      code: String(row.code || "").toUpperCase(),
      name: row.name || "",
      price: Number(row.now),
      percent: row.percent != null ? Number(row.percent) : null,
      source: row.source || "stock-api",
    }));
    console.log(
      JSON.stringify({
        ok: true,
        quotes,
        fetchedAt: new Date().toISOString(),
        provider: "stock-api/auto",
      }),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        quotes: [],
      }),
    );
    process.exit(2);
  }
}

main();
