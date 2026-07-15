import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import type { PublicUser } from "@/lib/auth/types";

let client: SupabaseClient | null = null;

function createSupabaseClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase Auth 未配置");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabaseAuthClient(): SupabaseClient {
  if (client) {
    return client;
  }
  client = createSupabaseClient();
  return client;
}

function toPublicUser(user: User): PublicUser {
  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  return {
    id: user.id,
    email: user.email || "",
    displayName: displayName || user.email?.split("@")[0] || "用户",
    createdAt: user.created_at,
  };
}

export async function registerSupabaseUser(input: {
  email: string;
  password: string;
  displayName?: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: "请输入有效的邮箱地址" };
  }
  if (input.password.length < 10 || input.password.length > 72) {
    return { ok: false as const, error: "密码长度需为 10–72 位" };
  }

  const { data, error } = await createSupabaseClient().auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        display_name: (input.displayName || email.split("@")[0] || "用户")
          .trim()
          .slice(0, 32),
      },
    },
  });
  if (error || !data.user) {
    return { ok: false as const, error: error?.message || "注册失败，请稍后重试" };
  }
  return {
    ok: true as const,
    user: toPublicUser(data.user),
    needsVerification: !data.user.email_confirmed_at,
  };
}

export async function authenticateSupabaseUser(email: string, password: string) {
  const { data, error } = await createSupabaseClient().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.user) {
    const notVerified = error?.message.toLowerCase().includes("confirm");
    return {
      ok: false as const,
      error: notVerified ? "邮箱尚未验证，请先完成邮箱验证" : "邮箱或密码不正确",
      code: notVerified ? ("EMAIL_NOT_VERIFIED" as const) : undefined,
    };
  }
  return { ok: true as const, user: toPublicUser(data.user) };
}

export async function findSupabaseUserById(id: string): Promise<PublicUser | null> {
  const { data, error } = await getSupabaseAuthClient().auth.admin.getUserById(id);
  if (error || !data.user || !data.user.email_confirmed_at) {
    return null;
  }
  return toPublicUser(data.user);
}

export async function verifySupabaseEmailCode(email: string, code: string) {
  const { data, error } = await createSupabaseClient().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: "signup",
  });
  if (error || !data.user) {
    return { ok: false as const, error: "验证码不正确或已过期" };
  }
  return { ok: true as const, user: toPublicUser(data.user) };
}

export async function resendSupabaseEmailCode(email: string) {
  const { error } = await createSupabaseClient().auth.resend({
    email: email.trim().toLowerCase(),
    type: "signup",
  });
  if (error) {
    return { ok: false as const, error: "验证码发送失败，请稍后重试" };
  }
  return { ok: true as const };
}
