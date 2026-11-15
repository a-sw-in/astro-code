import { NextResponse } from "next/server";
import { sendChatMessage } from "@/app/lib/support-db";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, message, astronautId } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const result = await sendChatMessage(
      sessionId || `SES-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      message,
      astronautId || "ACB-014"
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Failed to process support chat:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process chat" },
      { status: 500 }
    );
  }
}
