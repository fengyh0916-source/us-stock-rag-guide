/**
 * 是否强制邮箱验证码。
 * - 生产环境默认开启；开发环境默认关闭，便于本地联调。
 * - 可通过 EMAIL_VERIFICATION_REQUIRED 显式覆盖。
 */
export function isEmailVerificationRequired(): boolean {
  const v = (process.env.EMAIL_VERIFICATION_REQUIRED || "").trim().toLowerCase();
  if (v) {
    return v === "1" || v === "true" || v === "yes";
  }
  return process.env.NODE_ENV === "production";
}
