import { NextResponse } from "next/server";
import { isPlacesConfiguredServer } from "@/lib/server/places-server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * Lets the client know once, up front, whether Smart Location is usable at
 * all — never calls Google, just checks whether the server-only API key is
 * present, so the Add Expense form can skip requesting GPS permission
 * entirely when there's nothing to resolve it to.
 */
export async function GET() {
  const authClient = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  return NextResponse.json({ configured: isPlacesConfiguredServer });
}
