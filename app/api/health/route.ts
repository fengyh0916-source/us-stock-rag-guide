export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function probe(url: string, timeoutMs = 2500): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}

export async function GET() {
  const agentUrl = (process.env.AGENT_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
  const assetUrl = (process.env.ASSET_TRACKER_API_URL || "http://127.0.0.1:8000").replace(
    /\/$/,
    "",
  );

  const [agent, asset] = await Promise.all([
    probe(`${agentUrl}/api/health`),
    probe(`${assetUrl}/api/health`),
  ]);

  const ok = agent.ok; // 站点可无资产服务只读教程；助手依赖 agent
  return Response.json(
    {
      ok,
      time: new Date().toISOString(),
      dependencies: {
        agent: agent.ok,
        assetTracker: asset.ok,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
