import { NextResponse } from "next/server";
import { authenticateCredentials, clearSessionCookie, getAccountFromRequest, createSessionCookie } from "@/lib/auth";

export async function GET(request: Request) {
  const account = getAccountFromRequest(request);
  if (!account) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(account);
}

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const account = authenticateCredentials(body.username, body.password);
  if (!account) return NextResponse.json({ error: "That username or password is incorrect." }, { status: 401 });

  try {
    return NextResponse.json(account, { headers: { "Set-Cookie": createSessionCookie(account) } });
  } catch {
    return NextResponse.json({ error: "Account sign-in is not configured on the server." }, { status: 503 });
  }
}

export async function DELETE() {
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}