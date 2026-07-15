"use client";

import type { ClientEventName, ProductEventProperties } from "@/lib/analytics/types";

/**
 * 轻量、非阻塞的前端行为埋点。服务端会再次白名单校验字段；
 * 这里不得传问题原文、邮箱、持仓或其他个人信息。
 */
export function trackProductEvent(
  eventName: ClientEventName,
  properties: ProductEventProperties = {},
): void {
  try {
    void fetch("/api/analytics/events", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName, properties }),
    });
  } catch {
    // 统计失败不能影响正常使用。
  }
}
