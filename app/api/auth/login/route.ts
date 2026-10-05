import { authenticateCredentials, createSessionCookie } from "../../../../lib/auth";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The sign-in request was not valid." }, { status: 400 });
  }

  try {
    const account = authenticateCredentials(body.username, body.password);
    if (!account) return Response.json({ error: "Incorrect username or password." }, { status: 401 });
    return Response.json({ account }, { headers: { "Set-Cookie": createSessionCookie(account) } });
  } catch (error) {
    console.error("Sign-in failed:", error);
    return Response.json({ error: "Sign-in isn’t configured yet. Add AUTH_SESSION_SECRET to the server environment." }, { status: 503 });
  }
}
