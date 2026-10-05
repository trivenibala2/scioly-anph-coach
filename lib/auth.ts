import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type AccountRole = "admin" | "student";
export type AuthenticatedAccount = { username: string; role: AccountRole };

const COOKIE_NAME = "scienceoly_account_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 12;

function configuredAccounts() {
  return [
    { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, role: "admin" as const },
    { username: process.env.STUDENT_ONE_USERNAME, password: process.env.STUDENT_ONE_PASSWORD, role: "student" as const },
    { username: process.env.STUDENT_TWO_USERNAME, password: process.env.STUDENT_TWO_PASSWORD, role: "student" as const },
  ].filter((account): account is { username: string; password: string; role: AccountRole } =>
    Boolean(account.username && account.password),
  );
}

export function listStudentUsernames() {
  return configuredAccounts().filter((account) => account.role === "student").map((account) => account.username);
}

function sessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured.");
  return secret;
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function secureEqual(first: string, second: string) {
  const firstHash = createHmac("sha256", "scienceoly-account-compare").update(first).digest();
  const secondHash = createHmac("sha256", "scienceoly-account-compare").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

export function authenticateCredentials(username: unknown, password: unknown) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const account = configuredAccounts().find((candidate) => secureEqual(candidate.username, username));
  if (!account || !secureEqual(account.password, password)) return null;
  return { username: account.username, role: account.role } satisfies AuthenticatedAccount;
}

export function createSessionCookie(account: AuthenticatedAccount) {
  const payload = Buffer.from(JSON.stringify({ ...account, expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function getAccountFromRequest(request: Request): AuthenticatedAccount | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const entry = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const token = entry?.slice(COOKIE_NAME.length + 1);
  const separator = token?.lastIndexOf(".") ?? -1;
  if (!token || separator < 1) return null;

  const payload = token.slice(0, separator);
  const suppliedSignature = Buffer.from(token.slice(separator + 1));
  let expectedSignature: Buffer;
  try {
    expectedSignature = Buffer.from(sign(payload));
  } catch {
    return null;
  }
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AuthenticatedAccount> & { expiresAt?: unknown };
    const account = configuredAccounts().find((candidate) => candidate.username === parsed.username && candidate.role === parsed.role);
    if (!account || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now() / 1000) return null;
    return { username: account.username, role: account.role };
  } catch {
    return null;
  }
}

export function requireAccount(request: Request, role?: AccountRole) {
  const account = getAccountFromRequest(request);
  return account && (!role || account.role === role) ? account : null;
}