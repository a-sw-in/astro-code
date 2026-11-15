import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";

export async function GET() {
  try {
    const dbPath = path.join(process.cwd(), "backend", "astro_support.db");
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        sessions: [],
        totalCount: 0,
        activeSessions: 0,
        endedSessions: 0,
        deletedSessions: 0,
        escalatedSessions: 0,
        criticalSessions: 0,
        message: "No support database found",
      });
    }

    const db = new DatabaseSync(dbPath);

    // Ensure ground control archive table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS ground_control_chat_summaries (
        session_id TEXT PRIMARY KEY,
        astronaut_id TEXT DEFAULT 'ACB-014',
        created_at TEXT NOT NULL,
        ended_at TEXT,
        deleted_at TEXT,
        status TEXT DEFAULT 'ACTIVE',
        chief_complaint TEXT,
        triage_level TEXT DEFAULT 'ROUTINE',
        escalated INTEGER DEFAULT 0,
        escalation_reason TEXT,
        summary TEXT,
        key_recommendations TEXT,
        total_messages INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0
      );
    `);

    // 1. Fetch live/ended sessions from support_chat_sessions
    const liveRows = db.prepare(`
      SELECT session_id, astronaut_id, created_at, ended_at, status,
             chief_complaint, triage_level, escalated, escalation_reason,
             escalation_link, summary, key_recommendations, messages
      FROM support_chat_sessions
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `).all() as any[];

    const activeSessionIds = new Set<string>();

    const liveSessions = liveRows.map((r: any) => {
      activeSessionIds.add(r.session_id);
      let messages: any[] = [];
      let keyRecs: string[] = [];
      try { messages = r.messages ? JSON.parse(r.messages) : []; } catch {}
      try { keyRecs = r.key_recommendations ? JSON.parse(r.key_recommendations) : []; } catch {}

      const msgCount = messages.length;
      const userMessages = messages.filter((m: any) => m.sender === "user");
      const aiMessages = messages.filter((m: any) => m.sender === "ai");
      const hasEscalation = messages.some((m: any) => m.isEscalation);

      // Auto-generate preview summary if active session doesn't have an ended summary yet
      let summary = r.summary;
      if (!summary && userMessages.length > 0) {
        summary = `Live Consultation in progress (${userMessages.length} inquiries). Chief issue: "${r.chief_complaint}". Latest astronaut note: "${userMessages[userMessages.length - 1]?.text?.slice(0, 100)}..."`;
      }

      return {
        sessionId: r.session_id,
        astronautId: r.astronaut_id || "ACB-014",
        createdAt: r.created_at,
        endedAt: r.ended_at,
        deletedAt: null,
        status: r.status,
        isDeleted: false,
        chiefComplaint: r.chief_complaint,
        triageLevel: r.triage_level,
        escalated: r.escalated === 1,
        escalationReason: r.escalation_reason,
        summary: summary || "Session active. No clinical summary recorded yet.",
        keyRecommendations: keyRecs,
        messageCount: msgCount,
        hasEscalation,
      };
    });

    // 2. Fetch archived/deleted sessions from ground_control_chat_summaries
    const archiveRows = db.prepare(`
      SELECT session_id, astronaut_id, created_at, ended_at, deleted_at, status,
             chief_complaint, triage_level, escalated, escalation_reason,
             summary, key_recommendations, total_messages, is_deleted
      FROM ground_control_chat_summaries
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `).all() as any[];

    const deletedOrArchivedSessions: any[] = [];

    for (const r of archiveRows) {
      // If this session is not already listed in live sessions, it was deleted by the crew
      if (!activeSessionIds.has(r.session_id)) {
        let keyRecs: string[] = [];
        try { keyRecs = r.key_recommendations ? JSON.parse(r.key_recommendations) : []; } catch {}

        deletedOrArchivedSessions.push({
          sessionId: r.session_id,
          astronautId: r.astronaut_id || "ACB-014",
          createdAt: r.created_at,
          endedAt: r.ended_at,
          deletedAt: r.deleted_at,
          status: "DELETED BY CREW",
          isDeleted: true,
          chiefComplaint: r.chief_complaint,
          triageLevel: r.triage_level,
          escalated: r.escalated === 1,
          escalationReason: r.escalation_reason,
          summary: r.summary || "Summary archived prior to crew session deletion.",
          keyRecommendations: keyRecs,
          messageCount: r.total_messages || 0,
          hasEscalation: r.escalated === 1,
        });
      }
    }

    const allSessions = [...liveSessions, ...deletedOrArchivedSessions];

    const activeSessions = allSessions.filter((s) => s.status === "ACTIVE").length;
    const endedSessions = allSessions.filter((s) => s.status === "ENDED").length;
    const deletedSessions = allSessions.filter((s) => s.isDeleted).length;
    const escalatedSessions = allSessions.filter((s) => s.escalated).length;
    const criticalSessions = allSessions.filter((s) => s.triageLevel === "CRITICAL").length;

    return NextResponse.json({
      sessions: allSessions,
      totalCount: allSessions.length,
      activeSessions,
      endedSessions,
      deletedSessions,
      escalatedSessions,
      criticalSessions,
    });
  } catch (err: any) {
    console.error("Admin chat sessions error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
