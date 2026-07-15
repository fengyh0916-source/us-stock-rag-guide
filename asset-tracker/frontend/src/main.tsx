import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 在 React 挂载前就开始拉看板，与解析/渲染并行，省 100～400ms
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";
const earlyCurrency =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("asset-tracker:display-currency") as "CNY" | "USD" | null)) ||
  "CNY";
try {
  const url = `${API_BASE}/api/dashboard?display_currency=${earlyCurrency}`;
  (window as unknown as { __DASH_EARLY__?: Promise<Response> }).__DASH_EARLY__ = fetch(url);
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
