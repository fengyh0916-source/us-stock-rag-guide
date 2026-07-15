import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  createHolding,
  createPortfolio,
  deleteHolding,
  deletePortfolio,
  fetchDashboard,
  fetchDataStatus,
  renamePortfolio,
  reorderHoldings,
  reorderPortfolios,
  seedDemo,
  syncIbHoldings,
  updateHolding,
} from "./api";
import { readDashboardCache, writeDashboardCache } from "./dashboardCache";
import { currencyTag, formatCompact, formatMoney, formatPct, formatQty, pnlClass } from "./format";
import {
  IconEyeOff,
  IconMoreVertical,
  IconPencil,
  IconTrash,
  IconTrendDown,
  IconTrendUp,
  IconWallet,
} from "./icons";
import type {
  AssetType,
  Dashboard,
  DisplayCurrency,
  HoldingCurrency,
  HoldingRow,
  Market,
  PortfolioSummary,
} from "./types";
import "./App.css";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#f97316"];

type Modal =
  | null
  | { type: "portfolio" }
  | { type: "holding" }
  | { type: "edit"; holding: HoldingRow }
  | { type: "rename"; portfolio: PortfolioSummary };

function marketIcon(market?: Market | null, isAll?: boolean) {
  if (isAll) return "📁";
  if (market === "us") return "🇺🇸";
  if (market === "cn") return "🇨🇳";
  if (market === "cash") return "💵";
  return "📁";
}

function readSavedCurrency(): DisplayCurrency {
  try {
    const v = localStorage.getItem("asset-tracker:display-currency");
    return v === "USD" ? "USD" : "CNY";
  } catch {
    return "CNY";
  }
}

export default function App() {
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => readSavedCurrency());
  const [selected, setSelected] = useState<number | "all">("all");
  // 首屏：若有本地缓存立刻展示，避免干等 3～5 秒空白
  const [data, setData] = useState<Dashboard | null>(() => readDashboardCache(readSavedCurrency()));
  const [loading, setLoading] = useState(() => !readDashboardCache(readSavedCurrency()));
  const [refreshing, setRefreshing] = useState(false);
  const [, setStaleCache] = useState(() => !!readDashboardCache(readSavedCurrency()));
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [hasData, setHasData] = useState(() => {
    const cached = readDashboardCache("CNY");
    return !!cached && (cached.portfolios || []).some((p) => p.id !== "all");
  });
  const [hiddenIds, setHiddenIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem("asset-tracker:hidden-portfolios");
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  });
  const inflightRef = useRef(false);
  const pollSecRef = useRef(1);
  const anyOpenRef = useRef(true);
  const dataRef = useRef<Dashboard | null>(data);
  const dragPortfolioId = useRef<number | null>(null);
  const dragHoldingId = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    localStorage.setItem("asset-tracker:hidden-portfolios", JSON.stringify(hiddenIds));
  }, [hiddenIds]);

  useEffect(() => {
    try {
      localStorage.setItem("asset-tracker:display-currency", displayCurrency);
    } catch {
      /* ignore */
    }
  }, [displayCurrency]);

  useEffect(() => {
    if (menuOpenId == null) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpenId]);

  // 始终拉「全部账户」全量数据；切换组合只在前端筛选，避免反复请求行情
  const load = useCallback(
    async (opts?: { forceRefresh?: boolean; silent?: boolean }) => {
      const forceRefresh = opts?.forceRefresh ?? false;
      const silent = opts?.silent ?? false;
      if (silent && inflightRef.current) return;
      inflightRef.current = true;
      // 已有数据时一律当静默刷新，不挡界面
      const hasUi = !!dataRef.current || !!readDashboardCache(displayCurrency);
      if (silent || hasUi) setRefreshing(true);
      else setLoading(true);
      if (!silent && !hasUi) setError(null);
      try {
        let d: Dashboard | null = null;
        // 消费挂载前预取的 Promise（与 React 启动并行）
        const w = window as unknown as { __DASH_EARLY__?: Promise<Response> };
        if (!forceRefresh && w.__DASH_EARLY__) {
          const early = w.__DASH_EARLY__;
          delete w.__DASH_EARLY__;
          try {
            const res = await early;
            if (res.ok) {
              const body = (await res.json()) as Dashboard;
              if (body.display_currency === displayCurrency || !body.display_currency) {
                d = body;
              }
            }
          } catch {
            /* fall through */
          }
        }
        if (!d) {
          d = await fetchDashboard({
            portfolioId: "all",
            displayCurrency,
            forceRefresh,
          });
        }
        setData(d);
        writeDashboardCache(displayCurrency, d);
        setStaleCache(false);
        setHasData((d.portfolios || []).some((p) => p.id !== "all"));
        pollSecRef.current = Math.max(1, Number(d.poll_seconds) || 1);
        anyOpenRef.current = d.any_open;
      } catch (e) {
        // 有缓存时失败不盖掉旧数据，只提示
        if (!dataRef.current && !readDashboardCache(displayCurrency)) {
          setError(e instanceof Error ? e.message : "加载失败");
        } else if (!silent) {
          setError(e instanceof Error ? e.message : "刷新失败，仍显示上次数据");
        }
      } finally {
        inflightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [displayCurrency],
  );

  useEffect(() => {
    // 切换币种：先铺该币种缓存（若有），再后台拉最新
    const cached = readDashboardCache(displayCurrency);
    if (cached) {
      setData(cached);
      setStaleCache(true);
      setLoading(false);
      setHasData((cached.portfolios || []).some((p) => p.id !== "all"));
    }
    // 首屏 / 换币种：不 force，走服务端短缓存，首包更快
    void load({ forceRefresh: false, silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随币种变化
  }, [displayCurrency]);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      // 能力范围内最快：固定 1s 一轮，并 force 清缓存拿最新价
      const ms = Math.max(1, Number(pollSecRef.current) || 1) * 1000;
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await load({ forceRefresh: true, silent: true });
        }
        schedule();
      }, ms);
    };
    schedule();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load({ forceRefresh: true, silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  /** 当前选中组合的持仓（纯前端筛选，瞬时切换） */
  const viewHoldings = useMemo(() => {
    if (!data) return [];
    if (selected === "all") return data.holdings;
    return data.holdings.filter((h) => h.portfolio_id === selected);
  }, [data, selected]);

  /** 顶部四卡：全部用汇总；单组合用侧栏已算好的组合汇总 */
  const viewSummary = useMemo(() => {
    if (!data) {
      return {
        market_value: null as number | null,
        cost_value: null as number | null,
        pnl: null as number | null,
        pnl_pct: null as number | null,
      };
    }
    if (selected === "all") {
      return {
        market_value: data.total_market_value,
        cost_value: data.total_cost_value,
        pnl: data.total_pnl,
        pnl_pct: data.total_pnl_pct,
      };
    }
    const p = data.portfolios.find((x) => x.id === selected);
    return {
      market_value: p?.market_value ?? 0,
      cost_value: p?.cost_value ?? 0,
      pnl: p?.pnl ?? 0,
      pnl_pct: p?.pnl_pct ?? null,
    };
  }, [data, selected]);

  const chartData = useMemo(() => {
    if (!viewHoldings.length) return [];
    let rows: { key: string; symbol: string; title: string; value: number }[];
    if (selected === "all") {
      rows = viewHoldings
        .filter((h) => h.weight != null && h.weight > 0)
        .map((h) => ({
          key: `${h.id}`,
          symbol: h.asset_type === "cash" ? (h.currency || "CASH") : h.symbol,
          title: h.name || h.symbol,
          value: Number(((h.weight || 0) * 100).toFixed(2)),
        }));
    } else {
      // 单组合：按市值重算占比（同组合多为同币种）
      const vals = viewHoldings.map((h) => Math.max(0, h.market_value ?? 0));
      const sum = vals.reduce((a, b) => a + b, 0) || 1;
      rows = viewHoldings
        .map((h, i) => ({
          key: `${h.id}`,
          symbol: h.asset_type === "cash" ? (h.currency || "CASH") : h.symbol,
          title: h.name || h.symbol,
          value: Number(((vals[i] / sum) * 100).toFixed(2)),
        }))
        .filter((d) => d.value > 0);
    }
    // 图例与扇区统一按占比从大到小
    return rows.sort((a, b) => b.value - a.value);
  }, [viewHoldings, selected]);

  const selectedPortfolioMeta = useMemo(() => {
    if (selected === "all" || !data) return null;
    return data.portfolios.find((p) => p.id === selected) || null;
  }, [data, selected]);

  const realPortfolios = useMemo(
    () => (data?.portfolios || []).filter((p) => p.id !== "all"),
    [data],
  );
  const visiblePortfolios = useMemo(
    () =>
      (data?.portfolios || []).filter(
        (p) => p.id === "all" || !hiddenIds.includes(Number(p.id)),
      ),
    [data, hiddenIds],
  );

  useEffect(() => {
    if (typeof selected === "number" && hiddenIds.includes(selected)) {
      setSelected("all");
    }
  }, [hiddenIds, selected]);

  function hidePortfolio(id: number) {
    setHiddenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setMenuOpenId(null);
    if (selected === id) setSelected("all");
  }

  function unhideAll() {
    setHiddenIds([]);
  }

  async function onSeed() {
    setBusy(true);
    try {
      const r = await seedDemo();
      if (r.has_data === false) {
        setSelected("all");
        setHiddenIds([]);
      }
      setHasData(Boolean(r.has_data));
      await load({ forceRefresh: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  async function onSyncIb() {
    if (typeof selected !== "number") return;
    if (selectedPortfolioMeta?.market !== "us") {
      alert("请先选择美股组合");
      return;
    }
    if (
      !window.confirm(
        "将从本机 IB Gateway/TWS 同步美股持仓到当前组合：\n· 更新数量与成本\n· 用盈透「未实现盈亏」修正系统盈亏（手续费等差额，不改成本价）\n\n请确认 Gateway 已登录并开启 API。",
      )
    ) {
      return;
    }
    const fullReplace = window.confirm(
      "是否先清空本组合已有股票/ETF 再全量写入？\n\n确定 = 全量替换\n取消 = 合并更新（推荐）",
    );
    setBusy(true);
    try {
      const r = await syncIbHoldings(selected, fullReplace);
      const extra = r.price_source_summary ? `\n${r.price_source_summary}` : "";
      const errs = r.errors?.length ? `\n注意：${r.errors.join("；")}` : "";
      alert((r.message || "同步完成") + extra + errs);
      await load({ forceRefresh: true, silent: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "盈透同步失败");
    } finally {
      setBusy(false);
    }
  }

  // 首屏同步是否有数据（按钮文案）
  useEffect(() => {
    void fetchDataStatus()
      .then((s) => setHasData(s.has_data))
      .catch(() => undefined);
  }, []);

  async function onDeleteHolding(id: number) {
    if (!confirm("确认删除该持仓？")) return;
    setBusy(true);
    try {
      await deleteHolding(id);
      await load({ forceRefresh: true, silent: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePortfolio(id: number) {
    if (!confirm("删除组合将同时删除其全部持仓，确认？")) return;
    setBusy(true);
    try {
      await deletePortfolio(id);
      if (selected === id) setSelected("all");
      await load({ forceRefresh: true, silent: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  function onPortfolioDragStart(id: number) {
    dragPortfolioId.current = id;
  }

  async function onPortfolioDrop(targetId: number) {
    const from = dragPortfolioId.current;
    dragPortfolioId.current = null;
    if (from == null || from === targetId || !data) return;
    const ids = realPortfolios.map((p) => Number(p.id));
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, from);
    // 乐观更新侧栏顺序
    setData((prev) => {
      if (!prev) return prev;
      const all = prev.portfolios.find((p) => p.id === "all");
      const map = new Map(realPortfolios.map((p) => [Number(p.id), p]));
      const reordered = ids.map((id, i) => ({ ...map.get(id)!, sort_order: i }));
      return {
        ...prev,
        portfolios: all ? [all, ...reordered] : reordered,
      };
    });
    try {
      await reorderPortfolios(ids);
      await load({ forceRefresh: false, silent: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "排序失败");
      await load({ forceRefresh: true, silent: true });
    }
  }

  function onHoldingDragStart(id: number) {
    dragHoldingId.current = id;
  }

  async function onHoldingDrop(targetId: number) {
    const from = dragHoldingId.current;
    dragHoldingId.current = null;
    if (from == null || from === targetId || !data) return;
    // 在当前可见列表内拖拽，再写回全量顺序
    const visible = [...viewHoldings];
    const fromIdx = visible.findIndex((h) => h.id === from);
    const toIdx = visible.findIndex((h) => h.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [item] = visible.splice(fromIdx, 1);
    visible.splice(toIdx, 0, item);
    const visibleIds = new Set(visible.map((h) => h.id));
    const rest = data.holdings.filter((h) => !visibleIds.has(h.id));
    const next = [...visible, ...rest];
    setData((prev) => (prev ? { ...prev, holdings: next } : prev));
    try {
      await reorderHoldings(next.map((h) => h.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "排序失败");
      await load({ forceRefresh: true, silent: true });
    }
  }

  return (
    <div className="app">
      <div className="toolbar">
        <a className="back-link" href="/">
          <span className="back-link-icon" aria-hidden>
            ←
          </span>
          返回导航
        </a>
        <div className="toolbar-actions">
          <div className="seg" aria-label="汇总币种">
            <button
              type="button"
              className={displayCurrency === "CNY" ? "active" : ""}
              onClick={() => setDisplayCurrency("CNY")}
            >
              人民币
            </button>
            <button
              type="button"
              className={displayCurrency === "USD" ? "active" : ""}
              onClick={() => setDisplayCurrency("USD")}
            >
              美元
            </button>
          </div>
          <button
            className="btn"
            type="button"
            disabled={loading || busy || refreshing}
            onClick={() => void load({ forceRefresh: true, silent: true })}
          >
            刷新
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void onSeed()}>
            {hasData ? "清空数据" : "演示数据"}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="mobile-select">
        <select
          value={String(selected)}
          onChange={(e) => {
            const v = e.target.value;
            setSelected(v === "all" ? "all" : Number(v));
          }}
        >
          {visiblePortfolios.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-list">
            {visiblePortfolios.map((p) => {
              const isAll = p.id === "all";
              const pid = isAll ? null : Number(p.id);
              const tone = pnlClass(p.pnl);
              const menuOpen = pid != null && menuOpenId === pid;
              return (
                <div
                  key={String(p.id)}
                  className={`account-card ${selected === p.id ? "active" : ""} ${isAll ? "" : "draggable"}`}
                  draggable={!isAll}
                  onDragStart={() => pid != null && onPortfolioDragStart(pid)}
                  onDragOver={(e: DragEvent) => {
                    if (!isAll) e.preventDefault();
                  }}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    if (pid != null) void onPortfolioDrop(pid);
                  }}
                >
                  <div
                    className="account-card-main"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(isAll ? "all" : pid!)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(isAll ? "all" : pid!);
                      }
                    }}
                  >
                    <div className="account-card-top">
                      <div className="account-card-title">
                        <span className="account-card-icon">
                          {isAll ? (
                            <IconWallet size={18} />
                          ) : (
                            <span className="account-flag">{marketIcon(p.market)}</span>
                          )}
                        </span>
                        <span className="account-card-name">{p.name}</span>
                      </div>
                      {!isAll && (
                        <div
                          className="account-menu-wrap"
                          ref={menuOpen ? menuRef : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={`account-more ${menuOpen ? "open" : ""}`}
                            aria-label="更多操作"
                            title="更多"
                            onClick={() =>
                              setMenuOpenId((cur) => (cur === pid ? null : pid))
                            }
                          >
                            <IconMoreVertical size={16} />
                          </button>
                          {menuOpen && (
                            <div className="account-menu" role="menu">
                              <button
                                type="button"
                                className="account-menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setModal({ type: "rename", portfolio: p });
                                }}
                              >
                                <IconPencil size={16} />
                                <span>重命名</span>
                              </button>
                              <button
                                type="button"
                                className="account-menu-item"
                                role="menuitem"
                                onClick={() => hidePortfolio(pid!)}
                              >
                                <IconEyeOff size={16} />
                                <span>隐藏</span>
                              </button>
                              <button
                                type="button"
                                className="account-menu-item danger"
                                role="menuitem"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  void onDeletePortfolio(pid!);
                                }}
                              >
                                <IconTrash size={16} />
                                <span>删除</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="account-card-bottom">
                      <span className="account-card-mv">
                        {formatCompact(p.market_value, displayCurrency)}
                      </span>
                      {isAll ? (
                        <span className={`account-card-stat ${tone}`}>
                          {p.pnl >= 0 ? "+" : ""}
                          {formatCompact(p.pnl, displayCurrency)}
                        </span>
                      ) : (
                        <span className={`account-card-stat ${tone}`}>
                          {tone === "down" ? (
                            <IconTrendDown size={13} />
                          ) : (
                            <IconTrendUp size={13} />
                          )}
                          {formatPct(p.pnl_pct)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sidebar-foot">
            {hiddenIds.length > 0 && (
              <button className="btn btn-ghost sidebar-unhide" type="button" onClick={unhideAll}>
                显示已隐藏
              </button>
            )}
            <button
              className="btn"
              style={{ width: "100%" }}
              type="button"
              onClick={() => setModal({ type: "portfolio" })}
            >
              + 添加组合
            </button>
          </div>
        </aside>

        <section className="main">
          <div className="cards">
            <div className="card">
              <div className="card-label">总市值</div>
              <div className="card-value">
                {formatMoney(viewSummary.market_value, displayCurrency)}
              </div>
            </div>
            <div className="card">
              <div className="card-label">总成本</div>
              <div className="card-value">
                {formatMoney(viewSummary.cost_value, displayCurrency)}
              </div>
            </div>
            <div className="card">
              <div className="card-label">盈亏</div>
              <div className={`card-value ${pnlClass(viewSummary.pnl)}`}>
                {viewSummary.pnl == null
                  ? "—"
                  : `${viewSummary.pnl >= 0 ? "+" : ""}${formatMoney(viewSummary.pnl, displayCurrency)}`}
              </div>
            </div>
            <div className="card">
              <div className="card-label">盈亏比例</div>
              <div className={`card-value ${pnlClass(viewSummary.pnl)}`}>
                {formatPct(viewSummary.pnl_pct)}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>持仓明细</h3>
              <div className="panel-head-actions">
                {selectedPortfolioMeta?.market === "us" && typeof selected === "number" && (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    title="从本机 IB Gateway / TWS 同步美股持仓"
                    onClick={() => void onSyncIb()}
                  >
                    同步盈透持仓
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={selected === "all" || !data?.portfolios.some((p) => p.id === selected)}
                  onClick={() => setModal({ type: "holding" })}
                >
                  + 添加持仓
                </button>
              </div>
            </div>

            <div className="table-wrap">
              {!viewHoldings.length ? (
                <div className="empty">{loading ? "加载中…" : "暂无持仓"}</div>
              ) : (
                <table className="holdings-table">
                  <thead>
                    <tr>
                      <th className="col-drag" />
                      <th className="col-sym">
                        <span className="sym-head">
                          <span>代码</span>
                          <span className="sym-head-sep">/</span>
                          <span>名称</span>
                        </span>
                      </th>
                      <th className="col-num">数量</th>
                      <th className="col-num">市值</th>
                      <th className="col-price">
                        <span className="sym-head">
                          <span>成本</span>
                          <span className="sym-head-sep">/</span>
                          <span>现价</span>
                        </span>
                      </th>
                      <th className="col-num">盈亏</th>
                      <th className="col-num">盈亏%</th>
                      <th className="col-num">占比</th>
                      <th className="col-act" />
                    </tr>
                  </thead>
                  <tbody>
                    {viewHoldings.map((h) => {
                      const tone = h.asset_type === "cash" ? "flat" : pnlClass(h.pnl);
                      // 单组合下占比按当前视图重算；全部账户用服务端 weight
                      const weightPct =
                        selected === "all"
                          ? h.weight == null
                            ? null
                            : h.weight * 100
                          : (() => {
                              const sum = viewHoldings.reduce(
                                (a, x) => a + Math.max(0, x.market_value ?? 0),
                                0,
                              );
                              if (!sum || h.market_value == null) return null;
                              return (Math.max(0, h.market_value) / sum) * 100;
                            })();
                      return (
                      <tr
                        key={h.id}
                        className={`holding-row ${tone !== "flat" ? `row-${tone}` : ""}`}
                        draggable
                        onDragStart={() => onHoldingDragStart(h.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          void onHoldingDrop(h.id);
                        }}
                      >
                        <td className="col-drag drag-cell" title="拖拽排序">
                          ⠿
                        </td>
                        <td className="col-sym">
                          <div className="sym">
                            <div className="sym-code-line">
                              <span className="sym-flag">
                                {h.asset_type === "cash"
                                  ? "💵"
                                  : h.market === "us"
                                    ? "🇺🇸"
                                    : h.market === "cn"
                                      ? "🇨🇳"
                                      : "💵"}
                              </span>
                              <span className="sym-ticker">
                                {h.asset_type === "cash" ? h.currency : h.symbol}
                              </span>
                              <span className="tag">
                                {h.asset_type === "etf"
                                  ? "ETF"
                                  : h.asset_type === "fund"
                                    ? "基金"
                                    : h.asset_type === "cash"
                                      ? "现金"
                                      : "STOCK"}
                              </span>
                            </div>
                            <div className="sym-name">
                              {h.name}
                              {h.quote_error ? ` · ${h.quote_error}` : ""}
                            </div>
                          </div>
                        </td>
                        <td className="col-num">
                          {h.asset_type === "cash"
                            ? formatMoney(h.quantity, h.currency)
                            : formatQty(h.quantity)}
                        </td>
                        <td className="col-num">{formatMoney(h.market_value, h.currency)}</td>
                        <td className={`col-price ${tone}`}>
                          {h.asset_type === "cash" || h.price == null
                            ? "—"
                            : (
                              <>
                                {`${currencyTag(h.currency)}${Number(h.cost_price).toLocaleString(
                                  h.currency === "CNY" ? "zh-CN" : "en-US",
                                  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                                )}/${Number(h.price).toLocaleString(
                                  h.currency === "CNY" ? "zh-CN" : "en-US",
                                  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                                )}`}
                                {h.price_session === "pre" ? (
                                  <span className="session-tag" title="盘前价">盘前</span>
                                ) : h.price_session === "post" ? (
                                  <span className="session-tag" title="盘后价">盘后</span>
                                ) : null}
                              </>
                            )}
                        </td>
                        <td className={`col-num ${tone}`}>
                          {h.pnl == null
                            ? "—"
                            : `${h.pnl >= 0 ? "+" : ""}${formatMoney(h.pnl, h.currency)}`}
                        </td>
                        <td className={`col-num ${tone}`}>{formatPct(h.pnl_pct)}</td>
                        <td className="col-num">
                          {weightPct == null ? "—" : `${weightPct.toFixed(1)}%`}
                        </td>
                        <td className="col-act">
                          <div className="row-hover-actions">
                            <button
                              className="icon-btn"
                              type="button"
                              title="编辑"
                              aria-label="编辑"
                              onClick={() => setModal({ type: "edit", holding: h })}
                            >
                              <IconPencil size={15} />
                            </button>
                            <button
                              className="icon-btn icon-btn-danger"
                              type="button"
                              title="删除"
                              aria-label="删除"
                              onClick={() => void onDeleteHolding(h.id)}
                            >
                              <IconTrash size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel chart-panel chart-panel-allocation">
            <h3 className="chart-title">资产配置</h3>
            {chartData.length === 0 ? (
              <div className="empty">暂无配置数据</div>
            ) : (
              <div className="allocation-layout">
                <div className="chart-canvas chart-canvas-allocation">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="symbol"
                        innerRadius={70}
                        outerRadius={104}
                        paddingAngle={2}
                      >
                        {chartData.map((d, i) => (
                          <Cell key={d.key} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) => `${Number(v).toFixed(1)}%`}
                        labelFormatter={(_, payload) => {
                          const row = payload?.[0]?.payload as
                            | { symbol?: string; title?: string }
                            | undefined;
                          if (!row) return "";
                          return row.title && row.title !== row.symbol
                            ? `${row.symbol} · ${row.title}`
                            : String(row.symbol || row.title || "");
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-legend chart-legend-allocation">
                  {chartData.map((d, i) => (
                    <div className="legend-item" key={d.key}>
                      <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="legend-text">
                        <span className="legend-symbol">{d.symbol}</span>
                        <span className="legend-title">{d.title}</span>
                      </span>
                      <span className="legend-value">{d.value.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {modal?.type === "portfolio" && (
        <PortfolioModal
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (name, market) => {
            setBusy(true);
            try {
              await createPortfolio(name, market);
              setModal(null);
              await load({ forceRefresh: true, silent: true });
            } catch (e) {
              alert(e instanceof Error ? e.message : "创建失败");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {modal?.type === "rename" && (
        <RenamePortfolioModal
          name={modal.portfolio.name}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (name) => {
            setBusy(true);
            try {
              await renamePortfolio(Number(modal.portfolio.id), name);
              setModal(null);
              await load({ forceRefresh: false, silent: true });
            } catch (e) {
              alert(e instanceof Error ? e.message : "重命名失败");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {modal?.type === "holding" && typeof selected === "number" && (
        <HoldingModal
          title="添加持仓"
          busy={busy}
          market={(data?.portfolios.find((p) => p.id === selected)?.market as Market) || "us"}
          onClose={() => setModal(null)}
          onSubmit={async (form) => {
            setBusy(true);
            try {
              await createHolding({
                portfolio_id: selected,
                asset_type: form.asset_type,
                symbol: form.symbol,
                name: form.name,
                quantity: form.quantity,
                cost_price: form.cost_price ?? 1,
                currency: form.currency,
              });
              setModal(null);
              await load({ forceRefresh: true, silent: true });
            } catch (e) {
              alert(e instanceof Error ? e.message : "添加失败");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {modal?.type === "edit" && (
        <EditHoldingModal
          holding={modal.holding}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (form) => {
            setBusy(true);
            try {
              await updateHolding(modal.holding.id, form);
              setModal(null);
              await load({ forceRefresh: true, silent: true });
            } catch (e) {
              alert(e instanceof Error ? e.message : "保存失败");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function PortfolioModal({
  onClose,
  onSubmit,
  busy,
}: {
  onClose: () => void;
  onSubmit: (name: string, market: Market) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [market, setMarket] = useState<Market>("us");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), market);
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h3>创建投资组合</h3>
        <div className="field">
          <label>市场类型</label>
          <div className="chips">
            <button type="button" className={`chip ${market === "us" ? "active" : ""}`} onClick={() => setMarket("us")}>
              🇺🇸 美股
            </button>
            <button type="button" className={`chip ${market === "cn" ? "active" : ""}`} onClick={() => setMarket("cn")}>
              🇨🇳 A股
            </button>
            <button type="button" className={`chip ${market === "cash" ? "active" : ""}`} onClick={() => setMarket("cash")}>
              💵 现金
            </button>
          </div>
        </div>
        <div className="field">
          <label>组合名称</label>
          <input
            value={name}
            maxLength={20}
            placeholder={market === "cash" ? "例如：现金储备" : "例如：美股长线"}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <span className="hint">{name.length}/20</span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            创建
          </button>
        </div>
      </form>
    </div>
  );
}

function RenamePortfolioModal({
  name: initial,
  onClose,
  onSubmit,
  busy,
}: {
  name: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initial);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <h3>重命名组合</h3>
        <div className="field">
          <label>组合名称</label>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function HoldingModal({
  title,
  market,
  onClose,
  onSubmit,
  busy,
}: {
  title: string;
  market: Market;
  onClose: () => void;
  onSubmit: (form: {
    asset_type: AssetType;
    symbol?: string;
    name?: string;
    quantity: number;
    cost_price?: number;
    currency?: HoldingCurrency;
  }) => void;
  busy: boolean;
}) {
  const cashOnly = market === "cash";
  const [assetType, setAssetType] = useState<AssetType>(cashOnly ? "cash" : "stock");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState<HoldingCurrency>("CNY");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (assetType === "cash" || cashOnly) {
      onSubmit({
        asset_type: "cash",
        name: name.trim() || undefined,
        quantity: Number(quantity),
        cost_price: 1,
        currency,
      });
      return;
    }
    onSubmit({
      asset_type: assetType,
      symbol: symbol.trim(),
      name: name.trim() || undefined,
      quantity: Number(quantity),
      cost_price: Number(cost),
    });
  }

  const cashNamePlaceholder =
    currency === "CNY" ? "例如：人民币活期" : currency === "USD" ? "例如：美元现金" : "例如：港币现金";

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h3>{title}</h3>
        {!cashOnly && (
          <div className="field">
            <label>资产类型</label>
            <div className="chips">
              <button type="button" className={`chip ${assetType === "stock" ? "active" : ""}`} onClick={() => setAssetType("stock")}>
                股票
              </button>
              <button type="button" className={`chip ${assetType === "etf" ? "active" : ""}`} onClick={() => setAssetType("etf")}>
                ETF
              </button>
              {market === "cn" && (
                <button type="button" className={`chip ${assetType === "fund" ? "active" : ""}`} onClick={() => setAssetType("fund")}>
                  基金
                </button>
              )}
              <button type="button" className={`chip ${assetType === "cash" ? "active" : ""}`} onClick={() => setAssetType("cash")}>
                现金
              </button>
            </div>
          </div>
        )}
        {assetType === "cash" || cashOnly ? (
          <>
            <div className="field">
              <label>币种</label>
              <div className="chips">
                <button type="button" className={`chip ${currency === "CNY" ? "active" : ""}`} onClick={() => setCurrency("CNY")}>
                  人民币 CNY
                </button>
                <button type="button" className={`chip ${currency === "USD" ? "active" : ""}`} onClick={() => setCurrency("USD")}>
                  美元 USD
                </button>
                <button type="button" className={`chip ${currency === "HKD" ? "active" : ""}`} onClick={() => setCurrency("HKD")}>
                  港币 HKD
                </button>
              </div>
            </div>
            <div className="field">
              <label>名称</label>
              <input
                value={name}
                placeholder={cashNamePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>余额（{currency}）</label>
              <input
                value={quantity}
                type="number"
                min="0"
                step="any"
                placeholder="10000"
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>代码</label>
              <input
                value={symbol}
                placeholder={
                  market === "us"
                    ? "例如：AAPL"
                    : assetType === "fund"
                      ? "例如：016055"
                      : assetType === "etf"
                        ? "例如：510300"
                        : "例如：600519"
                }
                onChange={(e) => setSymbol(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>名称（可选）</label>
              <input value={name} placeholder="留空则自动获取" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>数量</label>
              <input
                value={quantity}
                type="number"
                min="0"
                step="any"
                placeholder="100"
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>{assetType === "fund" ? "成本净值" : "成本价"}（{market === "us" ? "USD" : "CNY"}）</label>
              <input
                value={cost}
                type="number"
                min="0"
                step="any"
                placeholder={assetType === "fund" ? "1.5" : "150"}
                onChange={(e) => setCost(e.target.value)}
                required
              />
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            添加
          </button>
        </div>
      </form>
    </div>
  );
}

function EditHoldingModal({
  holding,
  onClose,
  onSubmit,
  busy,
}: {
  holding: HoldingRow;
  onClose: () => void;
  onSubmit: (form: { quantity: number; cost_price: number; name: string }) => void;
  busy: boolean;
}) {
  const isCash = holding.asset_type === "cash";
  const [name, setName] = useState(holding.name);
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [cost, setCost] = useState(String(holding.cost_price));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            name: name.trim(),
            quantity: Number(quantity),
            cost_price: isCash ? 1 : Number(cost),
          });
        }}
      >
        <h3>编辑持仓 · {isCash ? holding.name : holding.symbol}</h3>
        <div className="field">
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>{isCash ? `余额（${holding.currency}）` : "数量"}</label>
          <input value={quantity} type="number" min="0" step="any" onChange={(e) => setQuantity(e.target.value)} required />
        </div>
        {!isCash && (
          <div className="field">
            <label>
              成本价（
              {holding.currency === "USD"
                ? "USD $"
                : holding.currency === "HKD"
                  ? "HKD HK$"
                  : "CNY ¥"}
              ）
            </label>
            <input value={cost} type="number" min="0" step="any" onChange={(e) => setCost(e.target.value)} required />
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
