"use client";

import { useEffect, useRef, useState } from "react";
import "../support/support.css";
import type { SupportMessage, SupportSessionRecord } from "../lib/support-db";

const QUICK_PROMPTS = [
  "Review my current vitals & biometric status from DB",
  "How much sleep and water have I logged today?",
  "What AI countermeasure exercises are prescribed for me?",
  "Experiencing nausea & space motion sickness (SAS)",
  "Blurry vision & optic focus difficulty (SANS)",
  "Connect me directly with Ground Flight Surgeon",
];

export default function SupportChatDashboard() {
  const [sessions, setSessions] = useState<SupportSessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [activeSession, setActiveSession] = useState<SupportSessionRecord | null>(null);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [selectedSummarySession, setSelectedSummarySession] = useState<SupportSessionRecord | null>(null);

  // Kaggle AI status — auto-read from env via API
  const [kaggleOnline, setKaggleOnline] = useState<boolean | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load all sessions and auto-check Kaggle AI status on mount
  useEffect(() => {
    loadSessions();
    checkKaggleStatus();
  }, []);

  async function checkKaggleStatus() {
    try {
      const res = await fetch("/api/support/kaggle-url");
      if (res.ok) {
        const data = await res.json();
        setKaggleOnline(Boolean(data.isOnline));
      }
    } catch {
      setKaggleOnline(false);
    }
  }

  useEffect(() => {
    scrollToBottom();
  }, [activeSession?.messages]);

  async function loadSessions(selectSessionId?: string) {
    setIsLoadingSessions(true);
    try {
      const res = await fetch("/api/support/sessions");
      if (res.ok) {
        const data: SupportSessionRecord[] = await res.json();
        setSessions(data);

        if (data.length > 0) {
          const targetId = selectSessionId || activeSessionId || data[0].session_id;
          const match = data.find((s) => s.session_id === targetId) || data[0];
          setActiveSessionId(match.session_id);
          setActiveSession(match);
        } else {
          // If no sessions exist, auto-create the first one
          await createNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to load support sessions:", err);
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function createNewChat() {
    setIsSending(true);
    try {
      const res = await fetch("/api/support/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ astronautId: "ACB-014" }),
      });
      if (res.ok) {
        const newSession: SupportSessionRecord = await res.json();
        setSessions((prev) => [newSession, ...prev]);
        setActiveSessionId(newSession.session_id);
        setActiveSession(newSession);
        setShowSummaryModal(false);
      }
    } catch (err) {
      console.error("Failed to create new support chat:", err);
    } finally {
      setIsSending(false);
    }
  }

  async function handleDeleteSession(sessionIdToDelete: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    if (!sessionIdToDelete) return;

    if (!confirm("Are you sure you want to delete this chat session? This cannot be undone.")) {
      return;
    }

    try {
      const res = await fetch(`/api/support/sessions?sessionId=${sessionIdToDelete}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const remaining = sessions.filter((s) => s.session_id !== sessionIdToDelete);
        setSessions(remaining);

        if (activeSessionId === sessionIdToDelete) {
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].session_id);
            setActiveSession(remaining[0]);
          } else {
            await createNewChat();
          }
        }
      }
    } catch (err) {
      console.error("Failed to delete chat session:", err);
    }
  }

  async function handleSendMessage(textToSend?: string) {
    const text = (textToSend || inputText).trim();
    if (!text || isSending || !activeSessionId) return;

    setInputText("");
    setIsSending(true);

    // Optimistically add user message
    const tempUserMsg: SupportMessage = {
      id: `temp-${Date.now()}`,
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    if (activeSession) {
      setActiveSession({
        ...activeSession,
        messages: [...activeSession.messages, tempUserMsg],
      });
    }

    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: text,
          astronautId: "ACB-014",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setActiveSession(data.session);
          setSessions((prev) =>
            prev.map((s) => (s.session_id === data.session.session_id ? data.session : s))
          );
        }
      }
    } catch (err) {
      console.error("Failed to send chat message:", err);
    } finally {
      setIsSending(false);
    }
  }

  async function handleEndSession() {
    if (!activeSessionId) return;
    setIsSending(true);

    try {
      const res = await fetch("/api/support/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setActiveSession(data.session);
          setSelectedSummarySession(data.session);
          setShowSummaryModal(true);
          setSessions((prev) =>
            prev.map((s) => (s.session_id === data.session.session_id ? data.session : s))
          );
        }
      }
    } catch (err) {
      console.error("Failed to end support session:", err);
    } finally {
      setIsSending(false);
    }
  }

  function handleSelectSession(session: SupportSessionRecord) {
    setActiveSessionId(session.session_id);
    setActiveSession(session);
    setShowSummaryModal(false);
  }

  return (
    <div className="support-container">
      {/* Left Sidebar: Sessions & History */}
      <aside className="support-sidebar">
        <div className="support-sidebar-header">
          <h3>
            <span>🛟</span> Tele-Triage Logs
          </h3>
          <button className="new-chat-btn" onClick={createNewChat} disabled={isSending}>
            <span>＋</span> New Support Chat
          </button>
        </div>

        <div className="sessions-list-scroll">
          {isLoadingSessions && sessions.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#64748b", fontSize: "0.8rem" }}>
              Loading tele-triage sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#64748b", fontSize: "0.8rem" }}>
              No previous support sessions recorded.
            </div>
          ) : (
            sessions.map((sess) => {
              const isActive = sess.session_id === activeSessionId;
              return (
                <div
                  key={sess.session_id}
                  className={`session-card${isActive ? " active" : ""}`}
                  onClick={() => handleSelectSession(sess)}
                >
                  <div className="session-card-top">
                    <span className="session-id-tag">{sess.session_id}</span>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <span
                        className={`session-status-badge ${
                          sess.status === "ACTIVE" ? "badge-active" : "badge-ended"
                        }`}
                      >
                        {sess.status}
                      </span>
                      <button
                        type="button"
                        className="session-delete-btn"
                        onClick={(e) => handleDeleteSession(sess.session_id, e)}
                        title="Delete this chat session"
                        aria-label="Delete chat"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <p className="session-complaint" title={sess.chief_complaint}>
                    {sess.chief_complaint}
                  </p>
                  <div className="session-card-footer">
                    <span className={`triage-indicator triage-${sess.triage_level}`}>
                      {sess.triage_level}
                    </span>
                    {sess.escalated && <span className="escalated-pill">SURGEON ESCALATED</span>}
                    <span>{sess.created_at.slice(5, 16)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Interface */}
      <section className="support-main">
        {/* Header */}
        <div className="support-chat-header">
          <div className="chat-header-title">
            <h2>
              <span className="pulse-dot"></span>
              Flight Surgeon AI Tele-Triage & Support
            </h2>
            <div className="chat-header-meta">
              <span>
                SESSION: <strong style={{ color: "#38bdf8" }}>{activeSession?.session_id || "..."}</strong>
              </span>
              <span>
                STATUS:{" "}
                <strong
                  style={{
                    color: activeSession?.status === "ACTIVE" ? "#4ade80" : "#94a3b8",
                  }}
                >
                  {activeSession?.status || "INITIALIZING"}
                </strong>
              </span>
              <span>
                ASTRONAUT: <strong>ACB-014</strong>
              </span>
              <span>
                TELEMETRY DB: <strong style={{ color: "#38bdf8" }}>astro_code_blue.db (LIVE LINKED)</strong>
              </span>
              <span>
                TRIAGE DB: <strong style={{ color: "#a78bfa" }}>astro_support.db</strong>
              </span>
              <span>
                KAGGLE AI:{" "}
                <strong
                  style={{
                    color: kaggleOnline === null ? "#94a3b8" : kaggleOnline ? "#4ade80" : "#f59e0b",
                  }}
                >
                  {kaggleOnline === null ? "CHECKING..." : kaggleOnline ? "🟢 QWEN 2.5 ONLINE" : "🔴 OFFLINE"}
                </strong>
              </span>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="delete-chat-header-btn"
              onClick={() => handleDeleteSession(activeSessionId)}
              disabled={isSending || !activeSessionId}
              title="Delete active chat session"
            >
              <span>🗑️</span> Delete Chat
            </button>
            {activeSession?.status === "ENDED" ? (
              <button
                className="view-summary-btn"
                onClick={() => {
                  setSelectedSummarySession(activeSession);
                  setShowSummaryModal(true);
                }}
              >
                📋 View Clinical Summary
              </button>
            ) : (
              <button
                className="end-session-btn"
                onClick={handleEndSession}
                disabled={isSending || !activeSession}
                title="Conclude chat and record summary to database"
              >
                <span>⏹</span> End & Summarize Chat
              </button>
            )}
          </div>
        </div>

        {/* Message Stream */}
        <div className="chat-messages-container">
          {activeSession?.messages?.map((msg) => {
            const isUser = msg.sender === "user";
            const isSystem = msg.sender === "system";

            return (
              <div
                key={msg.id}
                className={`chat-bubble-wrapper ${
                  isUser ? "user" : isSystem ? "system" : "ai"
                }`}
              >
                <div className="bubble-sender-meta">
                  <span>{isUser ? "Astronaut (ACB-014)" : isSystem ? "System" : "Flight Surgeon AI"}</span>
                  <span>{msg.timestamp}</span>
                </div>

                <div className="bubble-body">
                  <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>

                  {/* Medical Escalation Card if triggered */}
                  {msg.isEscalation && (
                    <div className="escalation-action-card">
                      <div className="escalation-badge">
                        <span>🚨</span> GROUND FLIGHT SURGEON UPLINK TRIGGERED
                      </div>
                      <div className="escalation-subtext">
                        Condition requires immediate clinical escalation. A direct secure uplink channel to
                        the Flight Surgeon ground team has been staged.
                      </div>
                      <a
                        href={msg.escalationLink || "https://www.google.com"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="escalation-link-button"
                      >
                        <span>✆</span> Connect with Help & Support Team (Flight Surgeon)
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {isSending && (
            <div className="chat-bubble-wrapper ai">
              <div className="bubble-sender-meta">
                <span>Flight Surgeon AI</span>
                <span>Evaluating physiological telemetry...</span>
              </div>
              <div className="bubble-body" style={{ color: "#38bdf8", fontStyle: "italic" }}>
                Analyzing symptoms against NASA space medicine protocols...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips (when session is active) */}
        {activeSession?.status === "ACTIVE" && (
          <div className="quick-chips-bar">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                className="chip-btn"
                onClick={() => handleSendMessage(prompt)}
                disabled={isSending}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Chat Input Bar */}
        <div className="chat-input-area">
          <input
            type="text"
            placeholder={
              activeSession?.status === "ENDED"
                ? "This session is concluded. Click '+ New Support Chat' to start a new chat."
                : "Type your medical symptom, inquiry, or question for the Flight Surgeon AI..."
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={isSending || activeSession?.status === "ENDED"}
          />
          <button
            className="send-msg-btn"
            onClick={() => handleSendMessage()}
            disabled={isSending || !inputText.trim() || activeSession?.status === "ENDED"}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </section>

      {/* Clinical Summary Modal */}
      {showSummaryModal && selectedSummarySession && (
        <div className="summary-modal-overlay" onClick={() => setShowSummaryModal(false)}>
          <div className="summary-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="summary-modal-header">
              <div>
                <h2>AI Clinical Triage Summary & Report</h2>
                <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                  Official Record filed in Mission Tele-Triage Database
                </span>
              </div>
              <button className="close-modal-btn" onClick={() => setShowSummaryModal(false)}>
                &times;
              </button>
            </div>

            <div className="summary-modal-body">
              <div className="summary-meta-grid">
                <div className="meta-field">
                  <label>Session Identifier</label>
                  <span>{selectedSummarySession.session_id}</span>
                </div>
                <div className="meta-field">
                  <label>Astronaut ID</label>
                  <span>{selectedSummarySession.astronaut_id}</span>
                </div>
                <div className="meta-field">
                  <label>Session Started</label>
                  <span>{selectedSummarySession.created_at}</span>
                </div>
                <div className="meta-field">
                  <label>Session Concluded</label>
                  <span>{selectedSummarySession.ended_at || "In Progress"}</span>
                </div>
                <div className="meta-field">
                  <label>Triage Urgency Level</label>
                  <span className={`triage-indicator triage-${selectedSummarySession.triage_level}`}>
                    {selectedSummarySession.triage_level}
                  </span>
                </div>
                <div className="meta-field">
                  <label>Flight Surgeon Escalation</label>
                  <span
                    style={{
                      color: selectedSummarySession.escalated ? "#f87171" : "#4ade80",
                    }}
                  >
                    {selectedSummarySession.escalated ? "ESCALATED TO GROUND" : "CABIN RESOLVED"}
                  </span>
                </div>
              </div>

              {selectedSummarySession.escalated && (
                <div className="escalation-action-card">
                  <div className="escalation-badge">
                    <span>🚨</span> FLIGHT SURGEON GROUND LINK ACTIVE
                  </div>
                  <div className="escalation-subtext">
                    Ground connection was established for this session. Link:{" "}
                    <strong>{selectedSummarySession.escalation_link}</strong>
                  </div>
                  <a
                    href={selectedSummarySession.escalation_link || "https://www.google.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="escalation-link-button"
                  >
                    Connect with Help & Support Team (Ground Flight Surgeon)
                  </a>
                </div>
              )}

              <div className="summary-section-box">
                <h4>Chief Medical Topic</h4>
                <p>{selectedSummarySession.chief_complaint}</p>
              </div>

              <div className="summary-section-box">
                <h4>AI Clinical Summary</h4>
                <p>{selectedSummarySession.summary || "No summary recorded."}</p>
              </div>

              {selectedSummarySession.key_recommendations?.length > 0 && (
                <div className="summary-section-box">
                  <h4>Clinical Recommendations & Directives</h4>
                  <ul className="recommendations-list">
                    {selectedSummarySession.key_recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="db-storage-confirm">
                <span>✔</span>
                <span>
                  PERSISTED TO DEDICATED DATABASE: <strong>backend/astro_support.db</strong> [
                  {selectedSummarySession.ended_at || selectedSummarySession.created_at}]
                </span>
              </div>
            </div>

            <div className="summary-modal-footer">
              <button
                className="view-summary-btn"
                onClick={() => {
                  setShowSummaryModal(false);
                  createNewChat();
                }}
              >
                ＋ Start Another Support Chat
              </button>
              <button className="end-session-btn" onClick={() => setShowSummaryModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
