import type { NextConfig } from "next";

const assetApi =
  process.env.ASSET_TRACKER_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
      `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
      ...(isProduction ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
  },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // CI/local verification can use a separate output directory without
  // interrupting a running `next dev` process. Vercel keeps the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 隐藏左下角 Next.js 开发指示器（红色 N / 英文报错面板，非站点 UI）
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    // Proxy portfolio/dashboard APIs to the FastAPI asset-tracker backend.
    // Keep site-owned routes: /api/chat, /api/asset-tracker/*
    return [
      {
        source: "/asset-tracker",
        destination: "/asset-tracker/index.html",
      },
      {
        source: "/asset-tracker/",
        destination: "/asset-tracker/index.html",
      },
      {
        source: "/api/dashboard",
        destination: `${assetApi}/api/dashboard`,
      },
      {
        source: "/api/portfolios",
        destination: `${assetApi}/api/portfolios`,
      },
      {
        source: "/api/portfolios/:path*",
        destination: `${assetApi}/api/portfolios/:path*`,
      },
      {
        source: "/api/holdings",
        destination: `${assetApi}/api/holdings`,
      },
      {
        source: "/api/holdings/:path*",
        destination: `${assetApi}/api/holdings/:path*`,
      },
      {
        source: "/api/seed-demo",
        destination: `${assetApi}/api/seed-demo`,
      },
      {
        source: "/api/data-status",
        destination: `${assetApi}/api/data-status`,
      },
      {
        source: "/api/performance",
        destination: `${assetApi}/api/performance`,
      },
      {
        source: "/api/ib/:path*",
        destination: `${assetApi}/api/ib/:path*`,
      },
    ];
  },
};

export default nextConfig;
