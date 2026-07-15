"use client";

import type { ReactNode, MouseEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { LoginReason } from "@/lib/auth/types";

type RequireAuthLinkProps = {
  href: string;
  reason: LoginReason;
  className?: string;
  children: ReactNode;
};

/** 未登录时拦截跳转并弹出登录；登录后跳到目标地址。 */
export default function RequireAuthLink({
  href,
  reason,
  className,
  children,
}: RequireAuthLinkProps) {
  const { requireAuth } = useAuth();

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    requireAuth(reason, () => {
      window.location.href = href;
    });
  }

  return (
    <a className={className} href={href} onClick={onClick}>
      {children}
    </a>
  );
}
