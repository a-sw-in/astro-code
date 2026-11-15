import { NextResponse } from "next/server";
import { endSessionAndSummarize } from "@/app/lib/support-db";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const result = endSessionAndSummarize(sessionId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Failed to end support session:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to end support session" },
      { status: 500 }
    );
  }
}
