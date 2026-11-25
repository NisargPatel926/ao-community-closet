// Passwords (scrypt), signed session cookies and flash messages.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(key, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// ------------------------------------------------------------------ cookies

export const isDev = () => process.env.CLOSET_DEV === "1";

function secret(): string {
  const k = process.env.SECRET_KEY;
  if (k) return k;
  if (isDev()) return "dev-only-secret";
  throw new ConfigError("SECRET_KEY");
}

export class ConfigError extends Error {
  constructor(readonly missing: string) {
    super(`Missing environment variable ${missing}`);
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(req: Request, name: string, value: string, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const SESSION = "closet_session";
const SESSION_DAYS = 60;
const sign = (s: string) => createHmac("sha256", secret()).update(s).digest("base64url");

export function sessionCookie(req: Request, userId: number): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = `${userId}.${exp}`;
  return cookie(req, SESSION, `${body}.${sign(body)}`, SESSION_DAYS * 86400);
}

export const clearSessionCookie = (req: Request) => cookie(req, SESSION, "", 0);

export function sessionUserId(req: Request): number | null {
  const v = parseCookies(req)[SESSION];
  if (!v) return null;
  const [uid, exp, sig] = v.split(".");
  if (!uid || !exp || !sig || !safeEqual(sig, sign(`${uid}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(uid);
}

// ------------------------------------------------------------------ flash messages

const FLASH = "closet_flash";
export type Flash = [kind: "ok" | "error", msg: string];

export function flashCookie(req: Request, msgs: Flash[]): string {
  return cookie(req, FLASH, Buffer.from(JSON.stringify(msgs)).toString("base64url"), 60);
}

export function readFlashes(req: Request): Flash[] {
  const v = parseCookies(req)[FLASH];
  if (!v) return [];
  try {
    const parsed = JSON.parse(Buffer.from(v, "base64url").toString());
    return Array.isArray(parsed) ? parsed.slice(0, 5).map((f) => [f[0] === "error" ? "error" : "ok", String(f[1])]) : [];
  } catch {
    return [];
  }
}

export const clearFlashCookie = (req: Request) => cookie(req, FLASH, "", 0);
