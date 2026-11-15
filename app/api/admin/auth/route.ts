import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    const adminUser = process.env.ADMIN_USERNAME || "groundcontrol";
    const adminPass = process.env.ADMIN_PASSWORD || "nasa2026admin";
    const secret = process.env.ADMIN_SESSION_SECRET || "acb014-ground-secret-key";

    if (username === adminUser && password === adminPass) {
      const response = NextResponse.json({ success: true });
      response.cookies.set("admin_token", secret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 8, // 8 hours
        path: "/",
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("admin_token");
  return response;
}
