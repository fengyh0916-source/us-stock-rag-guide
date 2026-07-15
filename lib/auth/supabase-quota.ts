import { getSupabaseAuthClient } from "@/lib/auth/supabase-auth";

type QuotaRow = {
  used: number;
  allowance: number;
  checked_in: boolean;
};

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function getRow(subjectType: "guest" | "user", subjectId: string) {
  const { data, error } = await getSupabaseAuthClient()
    .from("chat_daily_quotas")
    .select("used, allowance, checked_in")
    .eq("day", todayKey())
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .maybeSingle<QuotaRow>();
  if (error) {
    throw new Error(`读取问答额度失败: ${error.message}`);
  }
  return data;
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAuthClient().rpc(name, params);
  if (error) {
    throw new Error(`更新问答额度失败: ${error.message}`);
  }
  return data as T;
}

export async function getSupabaseGuestQuotaStatus(guestKey: string, limit: number) {
  const row = await getRow("guest", guestKey);
  const used = row?.used || 0;
  return {
    role: "guest" as const,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    needLogin: used >= limit,
  };
}

export async function getSupabaseUserQuotaStatus(userId: string, reward: number) {
  const row = await getRow("user", userId);
  const used = row?.used || 0;
  const allowance = row?.allowance || 0;
  return {
    role: "user" as const,
    checkedIn: Boolean(row?.checked_in),
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    reward,
  };
}

export function consumeSupabaseGuestChat(guestKey: string, limit: number) {
  return rpc<
    | { ok: true; remaining: number; used: number; limit: number }
    | { ok: false; code: "GUEST_LIMIT"; used: number; limit: number }
  >("consume_guest_chat", {
    p_day: todayKey(),
    p_subject_id: guestKey,
    p_limit: limit,
  });
}

export function consumeSupabaseUserChat(userId: string) {
  return rpc<
    | { ok: true; remaining: number; used: number; allowance: number }
    | {
        ok: false;
        code: "NEED_CHECKIN" | "QUOTA_EXCEEDED";
        used: number;
        allowance: number;
        checkedIn: boolean;
      }
  >("consume_user_chat", { p_day: todayKey(), p_subject_id: userId });
}

export async function refundSupabaseChat(subjectType: "guest" | "user", subjectId: string) {
  await rpc("refund_chat", {
    p_day: todayKey(),
    p_subject_type: subjectType,
    p_subject_id: subjectId,
  });
}

export function dailySupabaseCheckIn(userId: string, reward: number) {
  return rpc<
    | { ok: true; already: false; allowance: number; reward: number }
    | { ok: true; already: true; allowance: number; remaining: number; used: number }
  >("daily_chat_check_in", {
    p_day: todayKey(),
    p_subject_id: userId,
    p_reward: reward,
  });
}
