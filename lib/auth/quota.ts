import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { usesSupabaseAuth } from "@/lib/auth/account-service";
import {
  consumeSupabaseGuestChat,
  consumeSupabaseUserChat,
  dailySupabaseCheckIn,
  getSupabaseGuestQuotaStatus,
  getSupabaseUserQuotaStatus,
  refundSupabaseChat,
} from "@/lib/auth/supabase-quota";

const QUOTA_PATH = path.join(process.cwd(), "data", "auth", "chat-quota.json");

// Prevent lost updates when several requests mutate the local fallback file in
// the same Node.js process. Public multi-instance deployments should use the
// Supabase/Redis migration described in docs/PUBLIC_LAUNCH.md.
let mutationQueue: Promise<void> = Promise.resolve();

async function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release!: () => void;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/** 游客每日免费次数（按 IP） */
export function guestChatLimit(): number {
  const n = Number(process.env.GUEST_CHAT_LIMIT || "3");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

/** 登录用户每日签到奖励次数 */
export function checkInReward(): number {
  const n = Number(process.env.CHAT_CHECKIN_REWARD || "10");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

type GuestDay = Record<string, number>; // guestKey -> used
type UserDay = Record<
  string,
  {
    used: number;
    allowance: number;
    checkedIn: boolean;
  }
>;

type DayRecord = {
  guests: GuestDay;
  users: UserDay;
};

type Store = Record<string, DayRecord>;

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyDay(): DayRecord {
  return { guests: {}, users: {} };
}

async function loadStore(): Promise<Store> {
  try {
    const raw = await readFile(QUOTA_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(store: Store): Promise<void> {
  await mkdir(path.dirname(QUOTA_PATH), { recursive: true });
  const keys = Object.keys(store).sort();
  const keep = keys.slice(-5);
  const next: Store = {};
  for (const k of keep) {
    next[k] = store[k]!;
  }
  await writeFile(QUOTA_PATH, JSON.stringify(next, null, 2), "utf-8");
}

function dayRecord(store: Store, day: string): DayRecord {
  const raw = store[day];
  if (!raw || typeof raw !== "object") {
    return emptyDay();
  }
  // 兼容旧格式 { userId: number }
  if (!("guests" in raw) && !("users" in raw)) {
    return emptyDay();
  }
  return {
    guests: raw.guests || {},
    users: raw.users || {},
  };
}

export function guestKeyFromIp(ip: string): string {
  const h = createHash("sha256").update(`guest:${ip}`).digest("hex").slice(0, 24);
  return `g_${h}`;
}

export type QuotaStatus =
  | {
      role: "guest";
      limit: number;
      used: number;
      remaining: number;
      needLogin: boolean;
    }
  | {
      role: "user";
      checkedIn: boolean;
      allowance: number;
      used: number;
      remaining: number;
      reward: number;
    };

export async function getGuestQuotaStatus(guestKey: string): Promise<QuotaStatus> {
  const limit = guestChatLimit();
  if (usesSupabaseAuth()) {
    return getSupabaseGuestQuotaStatus(guestKey, limit);
  }
  const store = await loadStore();
  const day = dayRecord(store, todayKey());
  const used = day.guests[guestKey] || 0;
  const remaining = Math.max(0, limit - used);
  return {
    role: "guest",
    limit,
    used,
    remaining,
    needLogin: remaining <= 0,
  };
}

export async function getUserQuotaStatus(userId: string): Promise<QuotaStatus> {
  const reward = checkInReward();
  if (usesSupabaseAuth()) {
    return getSupabaseUserQuotaStatus(userId, reward);
  }
  const store = await loadStore();
  const day = dayRecord(store, todayKey());
  const row = day.users[userId] || { used: 0, allowance: 0, checkedIn: false };
  const remaining = Math.max(0, row.allowance - row.used);
  return {
    role: "user",
    checkedIn: row.checkedIn,
    allowance: row.allowance,
    used: row.used,
    remaining,
    reward,
  };
}

/** 游客消耗 1 次；超过返回失败 */
export async function consumeGuestChat(
  guestKey: string,
): Promise<
  | { ok: true; remaining: number; used: number; limit: number }
  | { ok: false; code: "GUEST_LIMIT"; used: number; limit: number }
> {
  if (usesSupabaseAuth()) {
    return consumeSupabaseGuestChat(guestKey, guestChatLimit());
  }
  return withMutationLock(async () => {
    const limit = guestChatLimit();
    const day = todayKey();
    const store = await loadStore();
    const rec = dayRecord(store, day);
    const used = rec.guests[guestKey] || 0;
    if (used >= limit) {
      return { ok: false as const, code: "GUEST_LIMIT" as const, used, limit };
    }
    rec.guests[guestKey] = used + 1;
    store[day] = rec;
    await saveStore(store);
    return {
      ok: true as const,
      remaining: limit - used - 1,
      used: used + 1,
      limit,
    };
  });
}

/** 返还一次游客额度；用于 Agent 只做澄清追问、未生成正式答案的回合。 */
export async function refundGuestChat(guestKey: string): Promise<void> {
  if (usesSupabaseAuth()) {
    await refundSupabaseChat("guest", guestKey);
    return;
  }
  await withMutationLock(async () => {
    const day = todayKey();
    const store = await loadStore();
    const rec = dayRecord(store, day);
    const used = rec.guests[guestKey] || 0;
    if (used <= 0) {
      return;
    }
    rec.guests[guestKey] = used - 1;
    store[day] = rec;
    await saveStore(store);
  });
}

/** 登录用户消耗 1 次（需已签到且仍有额度） */
export async function consumeUserChat(
  userId: string,
): Promise<
  | { ok: true; remaining: number; used: number; allowance: number }
  | {
      ok: false;
      code: "NEED_CHECKIN" | "QUOTA_EXCEEDED";
      used: number;
      allowance: number;
      checkedIn: boolean;
    }
> {
  if (usesSupabaseAuth()) {
    return consumeSupabaseUserChat(userId);
  }
  return withMutationLock(async () => {
    const day = todayKey();
    const store = await loadStore();
    const rec = dayRecord(store, day);
    const row = rec.users[userId] || { used: 0, allowance: 0, checkedIn: false };

    if (!row.checkedIn || row.allowance <= 0) {
      return {
        ok: false as const,
        code: "NEED_CHECKIN" as const,
        used: row.used,
        allowance: row.allowance,
        checkedIn: row.checkedIn,
      };
    }
    if (row.used >= row.allowance) {
      return {
        ok: false as const,
        code: "QUOTA_EXCEEDED" as const,
        used: row.used,
        allowance: row.allowance,
        checkedIn: row.checkedIn,
      };
    }

    row.used += 1;
    rec.users[userId] = row;
    store[day] = rec;
    await saveStore(store);
    return {
      ok: true as const,
      remaining: row.allowance - row.used,
      used: row.used,
      allowance: row.allowance,
    };
  });
}

/** 返还一次登录用户额度；用于 Agent 只做澄清追问、未生成正式答案的回合。 */
export async function refundUserChat(userId: string): Promise<void> {
  if (usesSupabaseAuth()) {
    await refundSupabaseChat("user", userId);
    return;
  }
  await withMutationLock(async () => {
    const day = todayKey();
    const store = await loadStore();
    const rec = dayRecord(store, day);
    const row = rec.users[userId];
    if (!row || row.used <= 0) {
      return;
    }
    row.used -= 1;
    rec.users[userId] = row;
    store[day] = rec;
    await saveStore(store);
  });
}

/** 每日签到：获得 reward 次额度（当天仅一次） */
export async function dailyCheckIn(
  userId: string,
): Promise<
  | { ok: true; already: false; allowance: number; reward: number }
  | { ok: true; already: true; allowance: number; remaining: number; used: number }
> {
  if (usesSupabaseAuth()) {
    return dailySupabaseCheckIn(userId, checkInReward());
  }
  return withMutationLock(async () => {
    const reward = checkInReward();
    const day = todayKey();
    const store = await loadStore();
    const rec = dayRecord(store, day);
    const existing = rec.users[userId];

    if (existing?.checkedIn) {
      return {
        ok: true as const,
        already: true as const,
        allowance: existing.allowance,
        remaining: Math.max(0, existing.allowance - existing.used),
        used: existing.used,
      };
    }

    rec.users[userId] = {
      used: 0,
      allowance: reward,
      checkedIn: true,
    };
    store[day] = rec;
    await saveStore(store);
    return { ok: true as const, already: false as const, allowance: reward, reward };
  });
}
