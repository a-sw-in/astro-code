"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// --- Types ---
type Assessment = {
  id: number;
  date: string;
  submittedAt: string;
  vitals: {
    heartRate: string | null;
    bloodPressure: string | null;
    oxygenSaturation: string | null;
    bodyTemperature: string | null;
  };
  wellness: {
    sleep: string | null;
    water: string | null;
    exercise: string | null;
    fatigue: string | null;
    stress: string | null;
  };
  environment: {
    co2: string | null;
    pressure: string | null;
    temp: string | null;
    radiation: string | null;
  };
  symptoms: string[];
  overallStatus: string;
  overallSummary: string;
  medicalAlert: string | null;
  exercises: number;
  suggestions: string[];
};

type ChatSessionSummary = {
  sessionId: string;
  astronautId: string;
  createdAt: string;
  endedAt: string | null;
  deletedAt: string | null;
  status: string;
  isDeleted: boolean;
  chiefComplaint: string;
  triageLevel: "ROUTINE" | "ELEVATED" | "CRITICAL" | string;
  escalated: boolean;
  escalationReason: string | null;
  summary: string;
  keyRecommendations: string[];
  messageCount: number;
  hasEscalation: boolean;
};

type HealthApiResponse = {
  assessments: Assessment[];
  totalCount: number;
  latestStatus: string;
  criticalCount: number;
  cautionCount: number;
  astronautId: string;
  message?: string;
};

type ChatApiResponse = {
  sessions: ChatSessionSummary[];
  totalCount: number;
  activeSessions: number;
  endedSessions: number;
  deletedSessions: number;
  escalatedSessions: number;
  criticalSessions: number;
  message?: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"health" | "chats">("health");
  const [healthData, setHealthData] = useState<HealthApiResponse | null>(null);
  const [chatData, setChatData] = useState<ChatApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatFilter, setChatFilter] = useState<"ALL" | "ACTIVE" | "ENDED" | "DELETED">("ALL");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [expandedAssessment, setExpandedAssessment] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState("");

  // Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toISOString().replace("T", " ").substring(0, 19) + " UTC"
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch telemetry & chat summaries
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [healthRes, chatRes] = await Promise.all([
        fetch("/api/admin/health-data"),
        fetch("/api/admin/chat-sessions"),
      ]);

      if (healthRes.status === 401 || chatRes.status === 401) {
        router.push("/admin/login");
        return;
      }

      if (!healthRes.ok || !chatRes.ok) {
        throw new Error("Unable to retrieve ground telemetry feeds.");
      }

      const hData: HealthApiResponse = await healthRes.json();
      const cData: ChatApiResponse = await chatRes.json();

      setHealthData(hData);
      setChatData(cData);
    } catch (err: any) {
      setError(err?.message || "Failed to load telemetry data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleLogout() {
    try {
      await fetch("/api/admin/auth", { method: "DELETE" });
    } finally {
      router.push("/admin/login");
    }
  }

  // Filtered chat sessions
  const filteredSessions = (chatData?.sessions || []).filter((s) => {
    if (chatFilter === "ACTIVE" && s.status !== "ACTIVE") return false;
    if (chatFilter === "ENDED" && s.status !== "ENDED") return false;
    if (chatFilter === "DELETED" && !s.isDeleted) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.chiefComplaint.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q) ||
      s.triageLevel.toLowerCase().includes(q)
    );
  });

  // Health assessment filter
  const filteredAssessments = (healthData?.assessments || []).filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.date.toLowerCase().includes(q) ||
      a.overallStatus.toLowerCase().includes(q) ||
      a.overallSummary.toLowerCase().includes(q) ||
      a.symptoms.some((sym) => sym.toLowerCase().includes(q))
    );
  });

  return (
    <div style={styles.container}>
      {/* GROUND CONTROL TOP CONSOLE */}
      <header style={styles.consoleHeader}>
        <div style={styles.brandRow}>
          <div style={styles.missionBadge}>⬡ GROUND CONTROL TELEMETRY</div>
          <div style={styles.statusIndicator}>
            <span style={styles.statusDot} />
            LIVE LINK: ISS / ORBIT
          </div>
          <div style={styles.clockDisplay}>⏱ {currentTime || "SYNCING..."}</div>
        </div>

        <div style={styles.headerMain}>
          <div>
            <h1 style={styles.title}>FLIGHT SURGEON & GROUND OPERATIONS</h1>
            <p style={styles.subtitle}>
              BIO-ASTRONAUTICS MEDICAL MONITORING · ASTRONAUT ID:{" "}
              <strong style={{ color: "#00d4ff" }}>
                {healthData?.astronautId || "ACB-014"}
              </strong>
            </p>
          </div>

          <div style={styles.headerActions}>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              style={styles.refreshButton}
              title="Refresh telemetry"
            >
              {refreshing ? "SYNCING..." : "⟳ REFRESH FEED"}
            </button>
            <button
              onClick={handleLogout}
              style={styles.logoutButton}
              title="Log out of ground console"
            >
              ⏻ TERMINATE SESSION
            </button>
          </div>
        </div>
      </header>

      {/* METRIC / TELEMETRY STATUS CARDS */}
      <div style={styles.metricsGrid}>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>OVERALL HEALTH STATUS</div>
          <div
            style={{
              ...styles.metricValue,
              color:
                healthData?.latestStatus?.toLowerCase() === "critical"
                  ? "#ff4d4d"
                  : healthData?.latestStatus?.toLowerCase() === "caution"
                  ? "#ffaa00"
                  : "#00ff88",
            }}
          >
            {healthData?.latestStatus || "NOMINAL"}
          </div>
          <div style={styles.metricSub}>
            Latest Assessment from Database
          </div>
        </div>

        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>ASSESSMENTS LOGGED</div>
          <div style={{ ...styles.metricValue, color: "#168bff" }}>
            {healthData?.totalCount ?? 0}
          </div>
          <div style={styles.metricSub}>
            {healthData?.criticalCount ?? 0} Critical · {healthData?.cautionCount ?? 0} Caution
          </div>
        </div>

        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>TOTAL CHAT SESSIONS</div>
          <div style={{ ...styles.metricValue, color: "#00d4ff" }}>
            {chatData?.totalCount ?? 0}
          </div>
          <div style={styles.metricSub}>
            {chatData?.activeSessions ?? 0} Active · {chatData?.endedSessions ?? 0} Concluded
          </div>
        </div>

        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>DELETED CHATS ARCHIVED</div>
          <div style={{ ...styles.metricValue, color: "#e066ff" }}>
            {chatData?.deletedSessions ?? 0}
          </div>
          <div style={styles.metricSub}>
            Summaries Preserved for Ground Control
          </div>
        </div>

        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>GROUND ESCALATIONS</div>
          <div
            style={{
              ...styles.metricValue,
              color: (chatData?.escalatedSessions ?? 0) > 0 ? "#ff4d4d" : "#00ff88",
            }}
          >
            {chatData?.escalatedSessions ?? 0}
          </div>
          <div style={styles.metricSub}>
            Flight Surgeon Alerts Triggered
          </div>
        </div>
      </div>

      {error && <div style={styles.errorBanner}>⚠ {error}</div>}

      {/* TABS & SEARCH CONTROLS */}
      <div style={styles.navigationRow}>
        <div style={styles.tabsWrapper}>
          <button
            onClick={() => setActiveTab("health")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "health" ? styles.tabButtonActive : {}),
            }}
          >
            🫀 HEALTH DATA & BIOMETRICS ({healthData?.totalCount ?? 0})
          </button>
          <button
            onClick={() => setActiveTab("chats")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "chats" ? styles.tabButtonActive : {}),
            }}
          >
            💬 CHAT DATA & SUMMARIES ({chatData?.totalCount ?? 0})
          </button>
        </div>

        <div style={styles.searchWrapper}>
          <input
            type="text"
            placeholder={
              activeTab === "health"
                ? "Filter assessments by date, symptom, status..."
                : "Search summaries by keyword, complaint, triage..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={styles.clearSearchBtn}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={styles.loadingState}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>RECEIVING DOWNLINK TELEMETRY...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: HEALTH DATA */}
          {activeTab === "health" && (
            <div style={styles.sectionContainer}>
              <div style={styles.sectionHeading}>
                <div>
                  <h2 style={styles.sectionTitle}>ASTRONAUT CLINICAL LOGS</h2>
                  <p style={styles.sectionDesc}>
                    Live records extracted from SQLite medical database (`astro_code_blue.db`)
                  </p>
                </div>
                <div style={styles.pillCount}>
                  Showing {filteredAssessments.length} of {healthData?.totalCount ?? 0} records
                </div>
              </div>

              {filteredAssessments.length === 0 ? (
                <div style={styles.emptyState}>
                  <p>No health assessment records match your filter.</p>
                </div>
              ) : (
                <div style={styles.cardsList}>
                  {filteredAssessments.map((a) => {
                    const isExpanded = expandedAssessment === a.id;
                    const statusLower = (a.overallStatus || "").toLowerCase();
                    const statusColor =
                      statusLower === "critical"
                        ? "#ff4d4d"
                        : statusLower === "caution" || statusLower === "elevated"
                        ? "#ffaa00"
                        : "#00ff88";

                    return (
                      <div
                        key={a.id}
                        style={{
                          ...styles.assessmentCard,
                          borderColor: isExpanded ? "#168bff" : "#1b2633",
                        }}
                      >
                        <div
                          style={styles.assessmentHeader}
                          onClick={() =>
                            setExpandedAssessment(isExpanded ? null : a.id)
                          }
                        >
                          <div style={styles.assessmentMainInfo}>
                            <div style={styles.dateBadge}>
                              📅 {a.date}
                              <span style={styles.subDate}>
                                ({a.submittedAt ? a.submittedAt.slice(11, 19) : "Logged"})
                              </span>
                            </div>
                            <span
                              style={{
                                ...styles.statusTag,
                                backgroundColor: `${statusColor}22`,
                                color: statusColor,
                                borderColor: `${statusColor}66`,
                              }}
                            >
                              ● {a.overallStatus.toUpperCase()}
                            </span>
                            {a.medicalAlert && (
                              <span style={styles.alertTag}>
                                ⚠ ALERT: {a.medicalAlert}
                              </span>
                            )}
                          </div>

                          <div style={styles.quickVitalsRow}>
                            <div style={styles.vitalPill}>
                              ❤️ HR:{" "}
                              <strong style={{ color: "#fff" }}>
                                {a.vitals.heartRate || "N/A"}
                              </strong>
                            </div>
                            <div style={styles.vitalPill}>
                              🩺 BP:{" "}
                              <strong style={{ color: "#fff" }}>
                                {a.vitals.bloodPressure || "N/A"}
                              </strong>
                            </div>
                            <div style={styles.vitalPill}>
                              💨 SpO₂:{" "}
                              <strong style={{ color: "#fff" }}>
                                {a.vitals.oxygenSaturation || "N/A"}
                              </strong>
                            </div>
                            <div style={styles.vitalPill}>
                              🌡 Temp:{" "}
                              <strong style={{ color: "#fff" }}>
                                {a.vitals.bodyTemperature || "N/A"}
                              </strong>
                            </div>
                            <button style={styles.expandButton}>
                              {isExpanded ? "▲ LESS" : "▼ DETAILS"}
                            </button>
                          </div>
                        </div>

                        {/* Collapsible details */}
                        {isExpanded && (
                          <div style={styles.detailsBody}>
                            <div style={styles.detailsGrid}>
                              {/* Summary */}
                              <div style={styles.detailBox}>
                                <div style={styles.boxTitle}>
                                  CLINICAL OVERVIEW SUMMARY
                                </div>
                                <p style={styles.boxText}>
                                  {a.overallSummary || "No clinical summary text provided."}
                                </p>
                              </div>

                              {/* Daily Intakes & Wellness */}
                              <div style={styles.detailBox}>
                                <div style={styles.boxTitle}>
                                  DAILY INTAKES & RECOVERY METRICS
                                </div>
                                <div style={styles.tableList}>
                                  <div style={styles.tableRow}>
                                    <span>Cumulative Sleep</span>
                                    <strong>{a.wellness.sleep || "Not logged"} (Target: 7.5h)</strong>
                                  </div>
                                  <div style={styles.tableRow}>
                                    <span>Hydration Volume</span>
                                    <strong>{a.wellness.water || "Not logged"} (Target: 2.5L)</strong>
                                  </div>
                                  <div style={styles.tableRow}>
                                    <span>Exercise Completed</span>
                                    <strong>{a.wellness.exercise || "Not logged"} (Target: 45m)</strong>
                                  </div>
                                  <div style={styles.tableRow}>
                                    <span>Fatigue / Stress Levels</span>
                                    <strong>
                                      Fatigue: {a.wellness.fatigue || "N/A"} · Stress: {a.wellness.stress || "N/A"}
                                    </strong>
                                  </div>
                                </div>
                              </div>

                              {/* Symptoms & SANS */}
                              <div style={styles.detailBox}>
                                <div style={styles.boxTitle}>
                                  REPORTED SYMPTOMS & NEURO-OCULAR
                                </div>
                                {a.symptoms.length > 0 ? (
                                  <div style={styles.symptomsList}>
                                    {a.symptoms.map((s, idx) => (
                                      <span key={idx} style={styles.symptomItem}>
                                        ⚠ {s}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p style={{ color: "#00ff88", fontSize: "13px" }}>
                                    ✓ Zero acute symptoms reported for this session.
                                  </p>
                                )}
                              </div>

                              {/* Cabin Environment */}
                              <div style={styles.detailBox}>
                                <div style={styles.boxTitle}>
                                  CABIN ENVIRONMENTAL TELEMETRY
                                </div>
                                <div style={styles.tableList}>
                                  <div style={styles.tableRow}>
                                    <span>CO₂ Concentration</span>
                                    <strong>{a.environment.co2 || "Nominal (<0.3%)"}</strong>
                                  </div>
                                  <div style={styles.tableRow}>
                                    <span>Cabin Pressure</span>
                                    <strong>{a.environment.pressure || "760 mmHg"}</strong>
                                  </div>
                                  <div style={styles.tableRow}>
                                    <span>Ambient Temperature</span>
                                    <strong>{a.environment.temp || "21.5 °C"}</strong>
                                  </div>
                                  <div style={styles.tableRow}>
                                    <span>Radiation Exposure</span>
                                    <strong>{a.environment.radiation || "0.45 mGy/d"}</strong>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Directives & Prescriptions */}
                            {a.suggestions.length > 0 && (
                              <div style={styles.suggestionsBox}>
                                <div style={styles.boxTitle}>
                                  🩺 FLIGHT SURGEON DIRECTIVES & PROTOCOLS
                                </div>
                                <ul style={styles.bulletList}>
                                  {a.suggestions.map((sug, idx) => (
                                    <li key={idx} style={styles.bulletItem}>
                                      {sug}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CHAT DATA & SUMMARIES */}
          {activeTab === "chats" && (
            <div style={styles.sectionContainer}>
              <div style={styles.sectionHeading}>
                <div>
                  <h2 style={styles.sectionTitle}>
                    TELE-TRIAGE CHAT AUDIT & CLINICAL SUMMARIES
                  </h2>
                  <p style={styles.sectionDesc}>
                    Permanent Ground Control record from `astro_support.db`. Chat summaries remain visible here even if deleted by the astronaut.
                  </p>
                </div>

                {/* Status filter buttons */}
                <div style={styles.filterButtonGroup}>
                  {(["ALL", "ACTIVE", "ENDED", "DELETED"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setChatFilter(mode)}
                      style={{
                        ...styles.filterBtn,
                        ...(chatFilter === mode ? styles.filterBtnActive : {}),
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {filteredSessions.length === 0 ? (
                <div style={styles.emptyState}>
                  <p>No chat session records match the current criteria.</p>
                </div>
              ) : (
                <div style={styles.cardsList}>
                  {filteredSessions.map((s) => {
                    const isExpanded = expandedSession === s.sessionId;
                    const triageColor =
                      s.triageLevel === "CRITICAL"
                        ? "#ff4d4d"
                        : s.triageLevel === "ELEVATED"
                        ? "#ffaa00"
                        : "#00ff88";

                    return (
                      <div
                        key={s.sessionId}
                        style={{
                          ...styles.chatCard,
                          borderColor: s.isDeleted
                            ? "#803300"
                            : s.escalated
                            ? "#ff4d4d"
                            : isExpanded
                            ? "#168bff"
                            : "#1b2633",
                          backgroundColor: s.isDeleted ? "#120804" : "#090d13",
                        }}
                      >
                        <div
                          style={styles.chatHeader}
                          onClick={() =>
                            setExpandedSession(isExpanded ? null : s.sessionId)
                          }
                        >
                          <div style={styles.chatHeaderLeft}>
                            <div style={styles.idRow}>
                              <span style={styles.sessionCode}>
                                {s.sessionId}
                              </span>
                              <span
                                style={{
                                  ...styles.statusTag,
                                  backgroundColor: `${triageColor}22`,
                                  color: triageColor,
                                  borderColor: `${triageColor}66`,
                                }}
                              >
                                TRIAGE: {s.triageLevel}
                              </span>
                              {s.isDeleted && (
                                <span style={styles.deletedBadge}>
                                  🗑 DELETED BY CREW (SUMMARY SAVED)
                                </span>
                              )}
                              {!s.isDeleted && s.status === "ACTIVE" && (
                                <span style={styles.activeBadge}>
                                  ● ACTIVE IN-FLIGHT SESSION
                                </span>
                              )}
                              {!s.isDeleted && s.status === "ENDED" && (
                                <span style={styles.endedBadge}>
                                  ✓ CONCLUDED & FILED
                                </span>
                              )}
                              {s.escalated && (
                                <span style={styles.escalatedBadge}>
                                  🚨 FLIGHT SURGEON ESCALATED
                                </span>
                              )}
                            </div>

                            <div style={styles.complaintText}>
                              Chief Complaint:{" "}
                              <strong style={{ color: "#fff" }}>
                                {s.chiefComplaint}
                              </strong>
                            </div>

                            <div style={styles.metaRow}>
                              <span>Astronaut: {s.astronautId}</span>
                              <span>·</span>
                              <span>Started: {s.createdAt}</span>
                              {s.endedAt && (
                                <>
                                  <span>·</span>
                                  <span>Ended: {s.endedAt}</span>
                                </>
                              )}
                              {s.deletedAt && (
                                <>
                                  <span>·</span>
                                  <span style={{ color: "#ff884d" }}>
                                    Crew Deleted: {s.deletedAt}
                                  </span>
                                </>
                              )}
                              <span>·</span>
                              <span>{s.messageCount} messages recorded</span>
                            </div>
                          </div>

                          <div style={styles.chatHeaderRight}>
                            <button style={styles.expandButton}>
                              {isExpanded ? "▲ HIDE SUMMARY" : "▼ VIEW SUMMARY"}
                            </button>
                          </div>
                        </div>

                        {/* Collapsible clinical summary */}
                        {isExpanded && (
                          <div style={styles.summaryBody}>
                            <div style={styles.summarySection}>
                              <div style={styles.summaryLabel}>
                                📋 CLINICAL CHAT SUMMARY (GROUND AUDIT)
                              </div>
                              <div style={styles.summaryContent}>
                                {s.summary}
                              </div>
                            </div>

                            {s.escalationReason && (
                              <div style={styles.escalationSection}>
                                <div style={styles.escalationLabel}>
                                  🚨 ESCALATION REASON TO FLIGHT SURGEON
                                </div>
                                <div style={styles.escalationContent}>
                                  {s.escalationReason}
                                </div>
                              </div>
                            )}

                            {s.keyRecommendations &&
                              s.keyRecommendations.length > 0 && (
                                <div style={styles.recommendationsSection}>
                                  <div style={styles.summaryLabel}>
                                    💡 KEY MEDICAL DIRECTIVES GIVEN TO ASTRONAUT
                                  </div>
                                  <ul style={styles.bulletList}>
                                    {s.keyRecommendations.map((rec, idx) => (
                                      <li key={idx} style={styles.bulletItem}>
                                        {rec}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* FOOTER */}
      <footer style={styles.footer}>
        ASTRO CODE BLUE · NASA SPACE HEALTH MISSION CONTROL · GROUND TELE-TRIAGE SYSTEM v1.0
      </footer>
    </div>
  );
}

// --- Space-Themed Ground Control Styles ---
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#000000",
    color: "#ffffff",
    fontFamily: "'Inter', sans-serif",
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  consoleHeader: {
    borderBottom: "1px solid #1b2633",
    paddingBottom: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
  },
  missionBadge: {
    backgroundColor: "rgba(22, 139, 255, 0.12)",
    border: "1px solid rgba(22, 139, 255, 0.3)",
    color: "#168bff",
    padding: "4px 12px",
    borderRadius: "16px",
    fontSize: "11px",
    letterSpacing: "2px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
  },
  statusIndicator: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    color: "#8994a3",
    fontFamily: "'Intel One Mono', monospace",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#00ff88",
    boxShadow: "0 0 8px #00ff88",
  },
  clockDisplay: {
    marginLeft: "auto",
    color: "#00d4ff",
    fontSize: "12px",
    fontFamily: "'Intel One Mono', monospace",
    letterSpacing: "1px",
  },
  headerMain: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: "16px",
  },
  title: {
    fontSize: "26px",
    fontWeight: 900,
    letterSpacing: "3px",
    color: "#ffffff",
    fontFamily: "'Intel One Mono', monospace",
    margin: 0,
  },
  subtitle: {
    color: "#8994a3",
    fontSize: "12px",
    letterSpacing: "1.5px",
    fontFamily: "'Intel One Mono', monospace",
    marginTop: "6px",
  },
  headerActions: {
    display: "flex",
    gap: "12px",
  },
  refreshButton: {
    backgroundColor: "#0d1826",
    border: "1px solid #168bff",
    color: "#168bff",
    padding: "10px 18px",
    borderRadius: "6px",
    fontSize: "11px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
    letterSpacing: "1px",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  logoutButton: {
    backgroundColor: "rgba(255, 77, 77, 0.1)",
    border: "1px solid rgba(255, 77, 77, 0.4)",
    color: "#ff6b6b",
    padding: "10px 18px",
    borderRadius: "6px",
    fontSize: "11px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
    letterSpacing: "1px",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "16px",
  },
  metricCard: {
    backgroundColor: "#090d13",
    border: "1px solid #1b2633",
    borderRadius: "8px",
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  metricLabel: {
    fontSize: "10px",
    letterSpacing: "2px",
    color: "#8994a3",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
  },
  metricValue: {
    fontSize: "26px",
    fontWeight: 900,
    fontFamily: "'Intel One Mono', monospace",
    letterSpacing: "1px",
  },
  metricSub: {
    fontSize: "11px",
    color: "#5f6c7b",
    fontFamily: "'Intel One Mono', monospace",
  },
  errorBanner: {
    backgroundColor: "rgba(255, 77, 77, 0.15)",
    border: "1px solid #ff4d4d",
    color: "#ff8080",
    padding: "12px 18px",
    borderRadius: "6px",
    fontSize: "13px",
    fontFamily: "'Intel One Mono', monospace",
  },
  navigationRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    borderBottom: "1px solid #1b2633",
    paddingBottom: "16px",
  },
  tabsWrapper: {
    display: "flex",
    gap: "12px",
  },
  tabButton: {
    backgroundColor: "transparent",
    border: "1px solid #1b2633",
    color: "#8994a3",
    padding: "12px 22px",
    borderRadius: "6px",
    fontSize: "12px",
    letterSpacing: "1.5px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  tabButtonActive: {
    backgroundColor: "#168bff",
    borderColor: "#168bff",
    color: "#ffffff",
    boxShadow: "0 0 16px rgba(22, 139, 255, 0.4)",
  },
  searchWrapper: {
    position: "relative",
    width: "360px",
    maxWidth: "100%",
  },
  searchInput: {
    width: "100%",
    backgroundColor: "#090d13",
    border: "1px solid #1b2633",
    borderRadius: "6px",
    padding: "10px 14px",
    color: "#ffffff",
    fontSize: "12px",
    fontFamily: "'Intel One Mono', monospace",
    outline: "none",
  },
  clearSearchBtn: {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    color: "#8994a3",
    cursor: "pointer",
    fontSize: "12px",
  },
  sectionContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  sectionHeading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: "12px",
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: 900,
    letterSpacing: "2px",
    color: "#ffffff",
    fontFamily: "'Intel One Mono', monospace",
    margin: 0,
  },
  sectionDesc: {
    fontSize: "12px",
    color: "#8994a3",
    fontFamily: "'Intel One Mono', monospace",
    marginTop: "4px",
  },
  pillCount: {
    fontSize: "11px",
    color: "#168bff",
    fontFamily: "'Intel One Mono', monospace",
    backgroundColor: "rgba(22, 139, 255, 0.08)",
    padding: "4px 10px",
    borderRadius: "12px",
    border: "1px solid rgba(22, 139, 255, 0.2)",
  },
  filterButtonGroup: {
    display: "flex",
    gap: "8px",
  },
  filterBtn: {
    backgroundColor: "#090d13",
    border: "1px solid #1b2633",
    color: "#8994a3",
    padding: "6px 14px",
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: "'Intel One Mono', monospace",
    cursor: "pointer",
  },
  filterBtnActive: {
    backgroundColor: "#168bff",
    borderColor: "#168bff",
    color: "#ffffff",
  },
  emptyState: {
    backgroundColor: "#090d13",
    border: "1px dashed #1b2633",
    borderRadius: "8px",
    padding: "48px 24px",
    textAlign: "center",
    color: "#8994a3",
    fontFamily: "'Intel One Mono', monospace",
    fontSize: "13px",
  },
  cardsList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  assessmentCard: {
    backgroundColor: "#090d13",
    border: "1px solid #1b2633",
    borderRadius: "8px",
    overflow: "hidden",
    transition: "border-color 0.2s",
  },
  assessmentHeader: {
    padding: "16px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    flexWrap: "wrap",
    gap: "14px",
  },
  assessmentMainInfo: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  dateBadge: {
    fontSize: "13px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
    color: "#ffffff",
  },
  subDate: {
    fontSize: "11px",
    color: "#8994a3",
    marginLeft: "6px",
    fontWeight: 400,
  },
  statusTag: {
    fontSize: "10px",
    fontWeight: 700,
    fontFamily: "'Intel One Mono', monospace",
    letterSpacing: "1px",
    padding: "3px 8px",
    borderRadius: "4px",
    border: "1px solid",
  },
  alertTag: {
    fontSize: "11px",
    color: "#ffaa00",
    fontFamily: "'Intel One Mono', monospace",
    backgroundColor: "rgba(255, 170, 0, 0.1)",
    padding: "3px 8px",
    borderRadius: "4px",
    border: "1px solid rgba(255, 170, 0, 0.3)",
  },
  quickVitalsRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  vitalPill: {
    backgroundColor: "#04070a",
    border: "1px solid #1b2633",
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: "'Intel One Mono', monospace",
    color: "#8994a3",
  },
  expandButton: {
    backgroundColor: "rgba(22, 139, 255, 0.1)",
    border: "1px solid rgba(22, 139, 255, 0.3)",
    color: "#168bff",
    padding: "6px 12px",
    borderRadius: "4px",
    fontSize: "10px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "1px",
  },
  detailsBody: {
    borderTop: "1px solid #1b2633",
    padding: "20px",
    backgroundColor: "#06090e",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px",
  },
  detailBox: {
    backgroundColor: "#090d13",
    border: "1px solid #1b2633",
    borderRadius: "6px",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  boxTitle: {
    fontSize: "10px",
    color: "#168bff",
    letterSpacing: "1.5px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
  },
  boxText: {
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#c3cad4",
    margin: 0,
  },
  tableList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  tableRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    fontFamily: "'Intel One Mono', monospace",
    color: "#8994a3",
    borderBottom: "1px solid #0f1620",
    paddingBottom: "4px",
  },
  symptomsList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  symptomItem: {
    backgroundColor: "rgba(255, 170, 0, 0.15)",
    border: "1px solid rgba(255, 170, 0, 0.4)",
    color: "#ffaa00",
    fontSize: "11px",
    fontFamily: "'Intel One Mono', monospace",
    padding: "3px 8px",
    borderRadius: "4px",
  },
  suggestionsBox: {
    backgroundColor: "#090d13",
    border: "1px solid rgba(22, 139, 255, 0.3)",
    borderRadius: "6px",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  bulletList: {
    margin: 0,
    paddingLeft: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  bulletItem: {
    fontSize: "12px",
    color: "#c3cad4",
    lineHeight: 1.5,
  },
  // Chat Card Styles
  chatCard: {
    borderRadius: "8px",
    border: "1px solid",
    overflow: "hidden",
    transition: "all 0.2s",
  },
  chatHeader: {
    padding: "18px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    cursor: "pointer",
    gap: "16px",
    flexWrap: "wrap",
  },
  chatHeaderLeft: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    flex: 1,
  },
  chatHeaderRight: {
    alignSelf: "center",
  },
  idRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  sessionCode: {
    fontSize: "12px",
    fontWeight: 900,
    fontFamily: "'Intel One Mono', monospace",
    color: "#00d4ff",
  },
  deletedBadge: {
    backgroundColor: "rgba(255, 102, 0, 0.15)",
    border: "1px solid #ff6600",
    color: "#ff9966",
    fontSize: "10px",
    fontWeight: 700,
    fontFamily: "'Intel One Mono', monospace",
    padding: "2px 8px",
    borderRadius: "4px",
    letterSpacing: "1px",
  },
  activeBadge: {
    backgroundColor: "rgba(0, 255, 136, 0.12)",
    border: "1px solid #00ff88",
    color: "#00ff88",
    fontSize: "10px",
    fontWeight: 700,
    fontFamily: "'Intel One Mono', monospace",
    padding: "2px 8px",
    borderRadius: "4px",
    letterSpacing: "1px",
  },
  endedBadge: {
    backgroundColor: "rgba(22, 139, 255, 0.12)",
    border: "1px solid #168bff",
    color: "#168bff",
    fontSize: "10px",
    fontWeight: 700,
    fontFamily: "'Intel One Mono', monospace",
    padding: "2px 8px",
    borderRadius: "4px",
    letterSpacing: "1px",
  },
  escalatedBadge: {
    backgroundColor: "rgba(255, 77, 77, 0.15)",
    border: "1px solid #ff4d4d",
    color: "#ff8080",
    fontSize: "10px",
    fontWeight: 700,
    fontFamily: "'Intel One Mono', monospace",
    padding: "2px 8px",
    borderRadius: "4px",
    letterSpacing: "1px",
  },
  complaintText: {
    fontSize: "14px",
    color: "#8994a3",
    fontFamily: "'Intel One Mono', monospace",
  },
  metaRow: {
    display: "flex",
    gap: "8px",
    fontSize: "11px",
    color: "#5f6c7b",
    fontFamily: "'Intel One Mono', monospace",
    flexWrap: "wrap",
  },
  summaryBody: {
    borderTop: "1px solid #1b2633",
    padding: "20px",
    backgroundColor: "#04070a",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  summarySection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  summaryLabel: {
    fontSize: "10px",
    color: "#168bff",
    letterSpacing: "1.5px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
  },
  summaryContent: {
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#d4dce6",
    whiteSpace: "pre-wrap",
    backgroundColor: "#090d13",
    border: "1px solid #1b2633",
    borderRadius: "6px",
    padding: "14px",
  },
  escalationSection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  escalationLabel: {
    fontSize: "10px",
    color: "#ff4d4d",
    letterSpacing: "1.5px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
  },
  escalationContent: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "#ff9999",
    backgroundColor: "rgba(255, 77, 77, 0.08)",
    border: "1px solid rgba(255, 77, 77, 0.3)",
    borderRadius: "6px",
    padding: "12px",
    fontFamily: "'Intel One Mono', monospace",
  },
  recommendationsSection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  loadingState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "80px 20px",
    gap: "16px",
  },
  spinner: {
    width: "36px",
    height: "36px",
    border: "3px solid #1b2633",
    borderTopColor: "#168bff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  loadingText: {
    fontSize: "11px",
    letterSpacing: "3px",
    color: "#8994a3",
    fontFamily: "'Intel One Mono', monospace",
  },
  footer: {
    marginTop: "auto",
    paddingTop: "24px",
    borderTop: "1px solid #1b2633",
    textAlign: "center",
    fontSize: "10px",
    letterSpacing: "2px",
    color: "#3a4a5c",
    fontFamily: "'Intel One Mono', monospace",
  },
};
