import { NextResponse } from "next/server";
import { getAllSessions, createNewSession, deleteSession } from "@/app/lib/support-db";

export async function GET() {
  try {
    const sessions = getAllSessions();
    return NextResponse.json(sessions);
  } catch (error: any) {
    console.error("Failed to fetch support sessions:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch support sessions" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const astronautId = body.astronautId || "ACB-014";
    const session = createNewSession(astronautId);
    return NextResponse.json(session, { status: 201 });
  } catch (error: any) {
    console.error("Failed to create support session:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create support session" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    let sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      const body = await req.json().catch(() => ({}));
      sessionId = body.sessionId;
    }

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const success = deleteSession(sessionId);
    return NextResponse.json({ success, sessionId });
  } catch (error: any) {
    console.error("Failed to delete support session:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete support session" },
      { status: 500 }
    );
  }
}
