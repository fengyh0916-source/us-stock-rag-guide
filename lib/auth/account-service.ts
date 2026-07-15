import {
  authenticateSupabaseUser,
  findSupabaseUserById,
  registerSupabaseUser,
  resendSupabaseEmailCode,
  verifySupabaseEmailCode,
} from "@/lib/auth/supabase-auth";
import {
  authenticateUser,
  findUserById,
  registerUser,
  verifyEmailCode,
} from "@/lib/auth/users-store";

function storageMode(): "local" | "supabase" {
  const configured = (process.env.AUTH_STORAGE_MODE || "").trim().toLowerCase();
  if (configured === "supabase") {
    return "supabase";
  }
  if (configured === "local" && process.env.NODE_ENV !== "production") {
    return "local";
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须设置 AUTH_STORAGE_MODE=supabase");
  }
  return "local";
}

export function usesSupabaseAuth(): boolean {
  return storageMode() === "supabase";
}

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName?: string;
}) {
  return usesSupabaseAuth() ? registerSupabaseUser(input) : registerUser(input);
}

export async function authenticateAccount(email: string, password: string) {
  return usesSupabaseAuth()
    ? authenticateSupabaseUser(email, password)
    : authenticateUser(email, password);
}

export async function findAccountById(id: string) {
  return usesSupabaseAuth() ? findSupabaseUserById(id) : findUserById(id);
}

export async function verifyAccountEmail(email: string, code: string) {
  return usesSupabaseAuth()
    ? verifySupabaseEmailCode(email, code)
    : verifyEmailCode(email, code);
}

export async function resendSupabaseAccountCode(email: string) {
  return resendSupabaseEmailCode(email);
}
