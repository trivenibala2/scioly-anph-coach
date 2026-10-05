import { getAccountFromRequest } from "../../../../lib/auth";

export async function GET(request: Request) {
  const account = getAccountFromRequest(request);
  return account ? Response.json({ account }) : Response.json({ error: "Not signed in." }, { status: 401 });
}
