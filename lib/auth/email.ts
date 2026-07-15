/**
 * 发送验证邮件。
 * 优先级：Resend API → 控制台/日志回退（开发可用）。
 */

export type SendEmailResult =
  | { ok: true; mode: "resend" | "console" }
  | { ok: false; error: string };

function siteName(): string {
  return process.env.EMAIL_SITE_NAME || "美股扫盲导航";
}

export function emailConfigured(): boolean {
  return Boolean((process.env.RESEND_API_KEY || "").trim());
}

export async function sendVerificationEmail(input: {
  to: string;
  code: string;
}): Promise<SendEmailResult> {
  const from = (process.env.EMAIL_FROM || "noreply@example.com").trim();
  const subject = `【${siteName()}】邮箱验证码 ${input.code}`;
  const text = [
    `你好，`,
    ``,
    `你的邮箱验证码是：${input.code}`,
    ``,
    `15 分钟内有效。如非本人操作，请忽略本邮件。`,
    ``,
    `— ${siteName()}`,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#0f172a">
      <p>你好，</p>
      <p>你的邮箱验证码是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#0284c7">${input.code}</p>
      <p style="color:#64748b;font-size:14px">15 分钟内有效。如非本人操作，请忽略本邮件。</p>
      <p style="color:#94a3b8;font-size:12px">— ${siteName()}</p>
    </div>
  `;

  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject,
          text,
          html,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("[email] Resend failed", res.status, body);
        return { ok: false, error: "邮件发送失败，请稍后重试" };
      }
      return { ok: true, mode: "resend" };
    } catch (e) {
      console.error("[email] Resend error", e);
      return { ok: false, error: "邮件发送失败，请稍后重试" };
    }
  }

  if (process.env.NODE_ENV === "production") {
    return { ok: false, error: "邮件服务尚未配置，请联系运营方" };
  }

  // 开发回退：打印到服务端日志，便于本地联调
  console.info(
    `[email:console] to=${input.to} code=${input.code} subject=${subject}`,
  );
  return { ok: true, mode: "console" };
}
