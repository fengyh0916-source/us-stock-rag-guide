"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { LoginReason, PublicUser } from "@/lib/auth/types";

export type RegisterResult =
  | { ok: true; needsVerification: false }
  | { ok: true; needsVerification: true; email: string; devCode?: string }
  | { ok: false; error: string };

type AuthContextValue = {
  user: PublicUser | null;
  loading: boolean;
  loginOpen: boolean;
  loginReason: LoginReason;
  openLogin: (reason?: LoginReason) => void;
  closeLogin: () => void;
  requireAuth: (reason: LoginReason, onAuthed?: () => void) => boolean;
  refresh: () => Promise<void>;
  login: (
    email: string,
    password: string,
  ) => Promise<
    | { ok: true }
    | { ok: false; error: string; needsVerification?: boolean; email?: string }
  >;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<RegisterResult>;
  verifyEmail: (
    email: string,
    code: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  resendCode: (
    email: string,
  ) => Promise<{ ok: true; devCode?: string; message?: string } | { ok: false; error: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState<LoginReason>("general");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as { user: PublicUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openLogin = useCallback((reason: LoginReason = "general") => {
    setLoginReason(reason);
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setPendingAction(null);
  }, []);

  const requireAuth = useCallback(
    (reason: LoginReason, onAuthed?: () => void) => {
      if (user) {
        onAuthed?.();
        return true;
      }
      setLoginReason(reason);
      setPendingAction(() => onAuthed ?? null);
      setLoginOpen(true);
      return false;
    },
    [user],
  );

  const finishLogin = useCallback(
    (nextUser: PublicUser) => {
      setUser(nextUser);
      setLoginOpen(false);
      const action = pendingAction;
      setPendingAction(null);
      action?.();
    },
    [pendingAction],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as {
        user?: PublicUser;
        error?: string;
        code?: string;
        email?: string;
      };
      if (!res.ok) {
        return {
          ok: false as const,
          error: data.error || "登录失败",
          needsVerification: data.code === "EMAIL_NOT_VERIFIED",
          email: data.email || email,
        };
      }
      if (data.user) {
        finishLogin(data.user);
      }
      return { ok: true as const };
    },
    [finishLogin],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = (await res.json()) as {
        error?: string;
        needsVerification?: boolean;
        email?: string;
        devCode?: string;
        user?: PublicUser;
      };
      if (!res.ok) {
        if (data.needsVerification) {
          return {
            ok: true as const,
            needsVerification: true as const,
            email: data.email || email,
            devCode: data.devCode,
          };
        }
        return { ok: false as const, error: data.error || "注册失败" };
      }
      // 邮箱+密码模式：直接登录
      if (!data.needsVerification && data.user) {
        finishLogin(data.user);
        return { ok: true as const, needsVerification: false as const };
      }
      if (data.needsVerification) {
        return {
          ok: true as const,
          needsVerification: true as const,
          email: data.email || email,
          devCode: data.devCode,
        };
      }
      return { ok: false as const, error: data.error || "注册失败" };
    },
    [finishLogin],
  );

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json()) as { user?: PublicUser; error?: string };
      if (!res.ok) {
        return { ok: false as const, error: data.error || "验证失败" };
      }
      if (data.user) {
        finishLogin(data.user);
      }
      return { ok: true as const };
    },
    [finishLogin],
  );

  const resendCode = useCallback(async (email: string) => {
    const res = await fetch("/api/auth/resend-code", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as {
      error?: string;
      devCode?: string;
      message?: string;
      ok?: boolean;
    };
    if (!res.ok) {
      return { ok: false as const, error: data.error || "发送失败" };
    }
    return {
      ok: true as const,
      devCode: data.devCode,
      message: data.message,
    };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      loginOpen,
      loginReason,
      openLogin,
      closeLogin,
      requireAuth,
      refresh,
      login,
      register,
      verifyEmail,
      resendCode,
      logout,
    }),
    [
      user,
      loading,
      loginOpen,
      loginReason,
      openLogin,
      closeLogin,
      requireAuth,
      refresh,
      login,
      register,
      verifyEmail,
      resendCode,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return ctx;
}
