import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

for (const filename of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  const filePath = path.join(process.cwd(), filename);
  if (!existsSync(filePath)) continue;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const required = [
  ["AUTH_SECRET", (value) => value.length >= 32, "至少 32 字符"],
  ["AUTH_STORAGE_MODE", (value) => value === "supabase", "必须为 supabase"],
  ["NEXT_PUBLIC_SUPABASE_URL", (value) => /^https:\/\//.test(value), "必须为 HTTPS URL"],
  ["SUPABASE_SERVICE_ROLE_KEY", (value) => value.length >= 20, "不能为空"],
  [
    "EMAIL_VERIFICATION_REQUIRED",
    (value) => ["true", "false"].includes(value.toLowerCase()),
    "必须明确设为 true 或 false",
  ],
  ["NEXT_PUBLIC_CONTACT_EMAIL", (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "必须为有效邮箱"],
  ["ADMIN_EMAILS", (value) => value.split(",").map((item) => item.trim()).filter(Boolean).length > 0 && value.split(",").every((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.trim())), "至少配置一个有效管理员邮箱"],
  ["AGENT_URL", (value) => /^https:\/\//.test(value), "生产环境必须使用 HTTPS"],
  ["ASSET_TRACKER_API_URL", (value) => /^https:\/\//.test(value), "生产环境必须使用 HTTPS"],
];

const failures = required.flatMap(([key, validate, hint]) => {
  const value = (process.env[key] || "").trim();
  return validate(value) ? [] : [`${key}: ${hint}`];
});

if (failures.length > 0) {
  console.error("生产发布预检未通过：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("生产发布环境变量预检通过。");
