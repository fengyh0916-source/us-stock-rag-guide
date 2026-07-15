import { DatabaseSync } from "node:sqlite";
import { createHash, randomInt, randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, existsSync } from "fs";
import path from "path";

import { isEmailVerificationRequired } from "@/lib/auth/config";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { PublicUser } from "@/lib/auth/types";

type StoredUser = PublicUser & {
  passwordHash: string;
  emailVerified: boolean;
};

const AUTH_DIR = path.join(process.cwd(), "data", "auth");
const DB_PATH = path.join(AUTH_DIR, "users.db");
const LEGACY_JSON = path.join(AUTH_DIR, "users.json");

const CODE_TTL_MS = 15 * 60 * 1000;

let db: DatabaseSync | null = null;
let migrated = false;

function getDb(): DatabaseSync {
  if (db) {
    return db;
  }
  mkdirSync(AUTH_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes(user_id);
  `);

  // 兼容旧库：补列
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("email_verified")) {
      db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.has("verified_at")) {
      db.exec("ALTER TABLE users ADD COLUMN verified_at TEXT");
    }
    // 旧用户默认视为已验证，避免突然无法登录
    db.exec(
      `UPDATE users SET email_verified = 1, verified_at = COALESCE(verified_at, created_at)
       WHERE email_verified = 0 AND verified_at IS NULL AND created_at < datetime('now')`,
    );
    // 更稳妥：凡是迁移前已存在且 verified_at 仍空、且不是刚刚注册的，在 ensure 时已 default 0
    // 将「没有任何验证码记录的老用户」标为已验证
    db.exec(`
      UPDATE users
      SET email_verified = 1,
          verified_at = COALESCE(verified_at, created_at)
      WHERE email_verified = 0
        AND id NOT IN (SELECT DISTINCT user_id FROM email_codes)
    `);
  } catch {
    /* ignore */
  }

  return db;
}

function rowToStored(row: {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: string;
  email_verified?: number;
}): StoredUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
    emailVerified: Boolean(row.email_verified),
  };
}

function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function migrateFromJsonIfNeeded(): void {
  if (migrated) {
    return;
  }
  migrated = true;
  const database = getDb();
  const count = database.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c > 0 || !existsSync(LEGACY_JSON)) {
    return;
  }
  try {
    const raw = readFileSync(LEGACY_JSON, "utf-8");
    const parsed = JSON.parse(raw) as { users?: Array<StoredUser & { passwordHash: string }> };
    const users = parsed.users || [];
    if (users.length === 0) {
      return;
    }
    const insert = database.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at, email_verified, verified_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    );
    for (const u of users) {
      insert.run(u.id, u.email, u.displayName, u.passwordHash, u.createdAt, u.createdAt);
    }
    try {
      renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrated-${Date.now()}`);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

function ensureReady(): void {
  migrateFromJsonIfNeeded();
  getDb();
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  ensureReady();
  const row = getDb()
    .prepare(
      `SELECT id, email, display_name, password_hash, created_at, email_verified
       FROM users WHERE email = ?`,
    )
    .get(normalizeEmail(email)) as
    | {
        id: string;
        email: string;
        display_name: string;
        password_hash: string;
        created_at: string;
        email_verified: number;
      }
    | undefined;
  return row ? rowToStored(row) : null;
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  ensureReady();
  const row = getDb()
    .prepare(
      `SELECT id, email, display_name, password_hash, created_at, email_verified
       FROM users WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        email: string;
        display_name: string;
        password_hash: string;
        created_at: string;
        email_verified: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  // 开启邮箱验证时：未验证用户不能维持会话
  if (isEmailVerificationRequired() && !row.email_verified) {
    return null;
  }
  return toPublic(rowToStored(row));
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<
  | { ok: true; user: PublicUser; needsVerification: boolean }
  | { ok: false; error: string }
> {
  ensureReady();
  const email = normalizeEmail(input.email);
  const password = input.password;
  const requireVerify = isEmailVerificationRequired();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "请输入有效的邮箱地址" };
  }
  if (password.length < 10) {
    return { ok: false, error: "密码至少 10 位" };
  }
  if (password.length > 72) {
    return { ok: false, error: "密码过长" };
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.emailVerified || !requireVerify) {
      // 无验证模式下只要邮箱占用即视为已注册
      return { ok: false, error: "该邮箱已注册，请直接登录" };
    }
    // 开启验证且未验证：允许用新密码覆盖并重新发码
    const displayName =
      (input.displayName || "").trim() || existing.displayName || email.split("@")[0] || "用户";
    getDb()
      .prepare(
        `UPDATE users SET password_hash = ?, display_name = ? WHERE id = ?`,
      )
      .run(hashPassword(password), displayName.slice(0, 32), existing.id);
    return {
      ok: true,
      user: {
        id: existing.id,
        email: existing.email,
        displayName: displayName.slice(0, 32),
        createdAt: existing.createdAt,
      },
      needsVerification: true,
    };
  }

  const displayName =
    (input.displayName || "").trim() || email.split("@")[0] || "用户";

  const verified = !requireVerify;
  const createdAt = new Date().toISOString();
  const user: StoredUser = {
    id: randomUUID(),
    email,
    displayName: displayName.slice(0, 32),
    createdAt,
    passwordHash: hashPassword(password),
    emailVerified: verified,
  };

  try {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, created_at, email_verified, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.email,
        user.displayName,
        user.passwordHash,
        user.createdAt,
        verified ? 1 : 0,
        verified ? createdAt : null,
      );
  } catch {
    return { ok: false, error: "该邮箱已注册，请直接登录" };
  }

  return {
    ok: true,
    user: toPublic(user),
    needsVerification: requireVerify,
  };
}

/** 生成 6 位验证码，写入库并返回明文（仅用于发信） */
export async function issueEmailCode(userId: string, email: string): Promise<string> {
  ensureReady();
  const code = String(randomInt(100000, 999999));
  const now = Date.now();
  // 清掉该用户旧码
  getDb().prepare(`DELETE FROM email_codes WHERE user_id = ?`).run(userId);
  getDb()
    .prepare(
      `INSERT INTO email_codes (id, user_id, email, code_hash, expires_at, created_at, attempts)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(randomUUID(), userId, normalizeEmail(email), hashCode(code), now + CODE_TTL_MS, now);
  return code;
}

export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  ensureReady();
  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(normalized);
  if (!user) {
    return { ok: false, error: "账号不存在，请先注册" };
  }
  if (user.emailVerified) {
    return { ok: true, user: toPublic(user) };
  }

  const row = getDb()
    .prepare(
      `SELECT id, code_hash, expires_at, attempts FROM email_codes
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(user.id) as
    | { id: string; code_hash: string; expires_at: number; attempts: number }
    | undefined;

  if (!row) {
    return { ok: false, error: "请先获取验证码" };
  }
  if (row.expires_at < Date.now()) {
    return { ok: false, error: "验证码已过期，请重新获取" };
  }
  if (row.attempts >= 8) {
    return { ok: false, error: "尝试次数过多，请重新获取验证码" };
  }

  getDb()
    .prepare(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?`)
    .run(row.id);

  if (hashCode(code.trim()) !== row.code_hash) {
    return { ok: false, error: "验证码不正确" };
  }

  const verifiedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE users SET email_verified = 1, verified_at = ? WHERE id = ?`,
    )
    .run(verifiedAt, user.id);
  getDb().prepare(`DELETE FROM email_codes WHERE user_id = ?`).run(user.id);

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    },
  };
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<
  | { ok: true; user: PublicUser }
  | { ok: false; error: string; code?: "EMAIL_NOT_VERIFIED" }
> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "邮箱或密码不正确" };
  }
  if (isEmailVerificationRequired() && !user.emailVerified) {
    return {
      ok: false,
      error: "邮箱尚未验证，请先完成邮箱验证",
      code: "EMAIL_NOT_VERIFIED",
    };
  }
  return { ok: true, user: toPublic(user) };
}

export async function countUsers(): Promise<number> {
  ensureReady();
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c;
}

export async function countVerifiedUsers(): Promise<number> {
  ensureReady();
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM users WHERE email_verified = 1")
    .get() as { c: number };
  return row.c;
}
