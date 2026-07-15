import type { PublicUser } from "@/lib/auth/types";

function configuredAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAnalyticsAdmin(user: PublicUser | null): boolean {
  if (!user) {
    return false;
  }
  const admins = configuredAdminEmails();
  if (admins.size === 0) {
    return process.env.NODE_ENV !== "production";
  }
  return admins.has(user.email.trim().toLowerCase());
}

export function withAnalyticsAdminFlag(user: PublicUser): PublicUser {
  return { ...user, isAdmin: isAnalyticsAdmin(user) };
}
