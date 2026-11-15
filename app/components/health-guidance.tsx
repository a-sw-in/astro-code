"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AssessmentRecord } from "../data/health-data";
import {
  ASSESSMENT_STORAGE_KEY,
  parseStoredAssessments,
  toAssessmentRecord,
} from "../data/health-assessments";
import {
  guidanceResearchItems,
  type GuidanceBackendResult,
  type GuidanceMeasurementId,
} from "../data/health-guidance";
import {
  advisorRecommendedActions,
  missionScenarios,
} from "../data/mission-advisor";

const measurementLabels: Record<GuidanceMeasurementId, string> = {
  heartRate: "Heart rate",
  bloodPressure: "Blood pressure",
  oxygenSaturation: "Oxygen saturation",
  bodyTemperature: "Body temperature",
  sleepDuration: "Sleep",
  waterIntake: "Water intake",
};

const measurementUnits: Record<GuidanceMeasurementId, string> = {
  heartRate: "BPM",
  bloodPressure: "mmHg",
  oxygenSaturation: "%",
  bodyTemperature: "°C",
  sleepDuration: "hours",
  waterIntake: "L",
};

const assessmentMeasurementIds: GuidanceMeasurementId[] = [
  "heartRate",
  "bloodPressure",
  "oxygenSaturation",
  "bodyTemperature",
  "sleepDuration",
  "waterIntake",
];

const sectionDisplayNames: Record<string, string> = {
  sleepAndWellness: "Sleep & Wellness",
  vitalSigns: "Cardiovascular Vital Signs",
  cognitiveHealth: "Cognitive & Mental Health",
  visionAndSymptoms: "Vision & Neuro-Ocular (SANS)",
  spaceEnvironment: "Space Cabin Environment",
  specializedMedical: "Specialized Biomarkers",
};

function getAssessmentMeasurement(
  record: AssessmentRecord,
  measurementId: GuidanceMeasurementId,
) {
  if (measurementId === "sleepDuration") {
    const total = record.analysis?.daily_aggregates?.total_sleep;
    if (total !== undefined && total > 0) return `${total} (daily total)`;
    return record.sleepDuration;
  }
  if (measurementId === "waterIntake") {
    const total = record.analysis?.daily_aggregates?.total_water;
    if (total !== undefined && total > 0) return `${total} (daily total)`;
    return record.waterIntake;
  }
  if (measurementId === "bloodPressure") {
    if (!record.systolic && !record.diastolic) return "";
    return `${record.systolic || "N/A"}/${record.diastolic || "N/A"}`;
  }
  return record[measurementId];
}

function formatRecordedDate(record: AssessmentRecord) {
  const rawDate = record.assessmentDate?.trim() || record.submittedAt;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  const hasTime = record.assessmentDate?.includes("T") || !record.assessmentDate?.trim();
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(hasTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

export default function HealthGuidance({
  backendResults = [],
}: {
  backendResults?: GuidanceBackendResult[];
}) {
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [hasLoadedAssessments, setHasLoadedAssessments] = useState(false);
  const [assessmentError, setAssessmentError] = useState("");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"database" | "local" | "none">("none");

  const loadAssessments = useCallback(async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/assessments");
      if (!response.ok) {
        throw new Error("Could not retrieve assessments from the backend.");
      }

      const data: unknown = await response.json();
      const parsed = parseStoredAssessments(
        JSON.stringify({
          version: 2,
          records: data,
        })
      );

      const parsedRecords = parsed.records.map(toAssessmentRecord);
      setRecords(parsedRecords);
      setDataSource(parsedRecords.length > 0 ? "database" : "none");
      setAssessmentError(
        parsed.invalidCount > 0
          ? `${parsed.invalidCount} assessment record(s) had invalid syntax and were skipped.`
          : "",
      );
    } catch {
      // Fallback to local storage if FastAPI server is unreachable
      try {
        const saved = window.localStorage.getItem(ASSESSMENT_STORAGE_KEY);
        if (saved) {
          const parsed = parseStoredAssessments(saved);
          const parsedRecords = parsed.records.map(toAssessmentRecord);
          setRecords(parsedRecords);
          setDataSource(parsedRecords.length > 0 ? "local" : "none");
          setAssessmentError("");
          return;
        }
      } catch {}

      setRecords([]);
      setDataSource("none");
      setAssessmentError(
        "Could not connect to database at http://127.0.0.1:8000. Start backend to fetch stored assessments.",
      );
    } finally {
      setHasLoadedAssessments(true);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(loadAssessments, 0);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ASSESSMENT_STORAGE_KEY || event.key === null) {
        loadAssessments();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", loadAssessments);
    window.addEventListener("pageshow", loadAssessments);

    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", loadAssessments);
      window.removeEventListener("pageshow", loadAssessments);
    };
  }, [loadAssessments]);

  const [todayStr, setTodayStr] = useState<string>("");
  const [todayFormatted, setTodayFormatted] = useState<string>("");

  useEffect(() => {
    const d = new Date();
    setTodayStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setTodayFormatted(new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d));
  }, []);

  const getRecordDayStr = (r: AssessmentRecord) => {
    const d = r.assessmentDate || r.submittedAt;
    if (!d) return "";
    try {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  };

  const todayRecords = records.filter((r) => getRecordDayStr(r) === todayStr);
  const hasTodayData = todayRecords.length > 0;
  const latestTodayRecord = hasTodayData ? todayRecords[todayRecords.length - 1] : null;

  const pastRecords = records.filter((r) => getRecordDayStr(r) !== todayStr);
  const mostRecentPastRecord = pastRecords.length > 0 ? pastRecords[pastRecords.length - 1] : null;

  const latestRecord = latestTodayRecord;
  const aiAnalysis = latestRecord?.analysis ?? null;
  const backendInsight = backendResults[0] ?? null;

  const selectedAction =
    advisorRecommendedActions.find((action) => action.id === selectedActionId) ?? null;
  const selectedScenario =
    missionScenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;

  const sourceLabel = hasTodayData && aiAnalysis
    ? aiAnalysis.ai_status === "connected"
      ? "SQLITE DATABASE · QWEN 2.5 AI ENGINE"
      : "SQLITE DATABASE · FLIGHT SURGEON RULES"
    : records.length > 0
      ? `ARCHIVED DATA (${records.length} PAST LOGS) · AWAITING TODAY'S LOG`
      : "DATABASE EMPTY · NO ASSESSMENTS";

  return (
    <main className="content health-guidance-page">
      <div className="mission-advisor">
        <header className="advisor-header">
          <div className="advisor-brand">
            <div className="advisor-spark" aria-hidden="true">
              <span>✦</span>
              <i className="spark-orbit spark-orbit-one" />
              <i className="spark-orbit spark-orbit-two" />
            </div>
            <div>
              <p className="advisor-eyebrow">CREW HEALTH INTELLIGENCE / ADVISOR NODE</p>
              <h1>AI MISSION ADVISOR</h1>
              <p className="advisor-subtitle">
                Spaceflight clinical intelligence, countermeasure exercises &amp; flight surgeon guidance.
              </p>
            </div>
          </div>
          <div className="advisor-status">
            <span
              className={`advisor-status-light${
                aiAnalysis || backendInsight ? " is-online" : ""
              }`}
            />
            <div>
              <span>AI STATUS</span>
              <strong>
                {aiAnalysis
                  ? "AI EVALUATION LOADED"
                  : backendInsight
                  ? "INSIGHT RECEIVED"
                  : "AWAITING ASSESSMENT"}
              </strong>
            </div>
            <i>{sourceLabel}</i>
          </div>
        </header>

        {assessmentError && (
          <p className="advisor-error" role="status">
            {assessmentError}
          </p>
        )}

        {/* Hero AI Diagnostic Panel */}
        <section className="advisor-insight-panel" aria-labelledby="advisor-insight-title">
          <div className="advisor-insight-copy">
            <div className="advisor-section-kicker">
              <span className="advisor-spark-mini" aria-hidden="true">✦</span>
              AI FLIGHT SURGEON HEALTH EVALUATION
              <span
                className={`advisor-insight-state${
                  aiAnalysis || backendInsight ? " is-ready" : ""
                }`}
              >
                {aiAnalysis ? "SAVED IN DATABASE" : backendInsight ? "PERSONALIZED RESULT" : "AWAITING ANALYSIS"}
              </span>
            </div>

            {aiAnalysis ? (
              <>
                <div className="advisor-priority-row">
                  <span
                    className={`advisor-priority priority-${
                      aiAnalysis.medical_alert?.severity || "low"
                    }`}
                  >
                    ALERT SEVERITY / {aiAnalysis.medical_alert?.severity?.toUpperCase() || "NOMINAL"}
                  </span>
                  <span
                    className={`guidance-status-tag status-${
                      aiAnalysis.overall_health_status?.toLowerCase() || "nominal"
                    }`}
                  >
                    CREW STATUS: {aiAnalysis.overall_health_status?.toUpperCase() || "NOMINAL"}
                  </span>
                </div>

                <h2 id="advisor-insight-title">
                  {aiAnalysis.overall_summary || "Astronaut health assessment telemetry nominal across flight parameters."}
                </h2>

                {aiAnalysis.medical_alert && (
                  <div
                    className={`advisor-medical-alert-box severity-${
                      aiAnalysis.medical_alert.severity || "low"
                    }`}
                  >
                    <div className="alert-badge-row">
                      <span className="alert-flag">
                        {aiAnalysis.medical_alert.seek_medical_support
                          ? "⚠️ FLIGHT SURGEON SUPPORT ADVISED"
                          : "✓ CLINICAL STATUS NOMINAL"}
                      </span>
                    </div>
                    <p className="alert-advice-text">
                      {aiAnalysis.medical_alert.advice ||
                        "Continue following standard in-flight health monitoring protocols."}
                    </p>
                  </div>
                )}

                {aiAnalysis.today_submissions_breakdown && (
                  <div
                    className="advisor-progression-box"
                    style={{
                      background: "rgba(3, 14, 28, 0.75)",
                      border: "1px solid rgba(0, 212, 255, 0.3)",
                      borderRadius: "8px",
                      padding: "12px 16px",
                      margin: "14px 0",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#38bdf8",
                        letterSpacing: "0.8px",
                        display: "block",
                        marginBottom: "6px",
                        fontFamily: "'Intel One Mono', monospace",
                      }}
                    >
                      TODAY'S MULTI-REPORT PROGRESSION TO AI ({aiAnalysis.today_submissions_breakdown.submission_count} SUBMISSIONS)
                    </span>
                    <ul style={{ margin: 0, paddingLeft: "18px", color: "#e2e8f0", fontSize: "12px", lineHeight: "1.65" }}>
                      <li><strong>Sleep:</strong> {aiAnalysis.today_submissions_breakdown.sleep.summary_text}</li>
                      <li><strong>Hydration:</strong> {aiAnalysis.today_submissions_breakdown.water.summary_text}</li>
                      <li><strong>Exercise:</strong> {aiAnalysis.today_submissions_breakdown.exercise.summary_text}</li>
                    </ul>
                  </div>
                )}

                {aiAnalysis.insights && aiAnalysis.insights.length > 0 && (
                  <div className="advisor-insight-reason">
                    <span>KEY CLINICAL FINDINGS</span>
                    <p>{aiAnalysis.insights.slice(0, 3).join(" • ")}</p>
                  </div>
                )}

                <p className="advisor-disclaimer">
                  Aerospace clinical AI decision support. Telemetry synchronized with flight database.
                </p>
              </>
            ) : backendInsight ? (
              <>
                <div className="advisor-priority-row">
                  <span className={`advisor-priority priority-${backendInsight.priority ?? "unset"}`}>
                    PRIORITY / {backendInsight.priority?.toUpperCase() ?? "NOT PROVIDED"}
                  </span>
                </div>
                <h2 id="advisor-insight-title">
                  {backendInsight.observation ||
                    `Insight for ${measurementLabels[backendInsight.measurementId].toLowerCase()}`}
                </h2>
                <div className="advisor-insight-reason">
                  <span>WHY IT MATTERS</span>
                  <p>{backendInsight.explanation}</p>
                </div>
                <div className="advisor-next-action">
                  <span>RECOMMENDED NEXT ACTION</span>
                  <p>{backendInsight.preventiveAction}</p>
                </div>
                <p className="advisor-disclaimer">
                  Backend-supplied guidance only. This interface does not replace mission medical instructions.
                </p>
              </>
            ) : !hasLoadedAssessments ? (
              <div className="advisor-empty-state" role="status">
                <span className="advisor-loading-mark" aria-hidden="true" />
                <h2 id="advisor-insight-title">Connecting to database telemetry...</h2>
                <p>Retrieving stored astronaut assessment records and AI flight surgeon evaluations.</p>
              </div>
            ) : !latestRecord ? (
              <div className="advisor-empty-state">
                <span className="advisor-empty-icon" aria-hidden="true">✦</span>
                <h2 id="advisor-insight-title">
                  No health assessment recorded for today ({todayFormatted}).
                </h2>
                <p>
                  {records.length > 0
                    ? `Archived records from previous mission dates are saved in the archive (${records.length} historical logs). Complete today's health self-assessment to generate today's personalized AI flight surgeon evaluation, six-domain clinical triage, and countermeasure exercise routines.`
                    : "No assessment record is currently stored in the SQLite database. Submit astronaut telemetry to generate AI evaluations, medical alerts, and countermeasure exercise routines."}
                </p>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "14px" }}>
                  <Link className="advisor-primary-link" href="/assessment">
                    LOG TODAY&apos;S HEALTH ASSESSMENT <span aria-hidden="true">↗</span>
                  </Link>
                  {records.length > 0 && (
                    <Link className="advisor-secondary-link" href="/past-records" style={{ padding: "8px 16px", borderRadius: "6px", background: "rgba(0, 212, 255, 0.1)", border: "1px solid rgba(0, 212, 255, 0.3)", color: "#00d4ff", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>
                      VIEW PAST RECORDS ARCHIVE <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="advisor-empty-state">
                <span className="advisor-awaiting-icon" aria-hidden="true">⌁</span>
                <h2 id="advisor-insight-title">Telemetry saved in database.</h2>
                <p>
                  Measurements are stored in SQLite. Re-submitting or syncing will run the AI clinical evaluation engine.
                </p>
                <Link className="advisor-primary-link" href="/assessment">
                  NEW ASSESSMENT <span aria-hidden="true">↗</span>
                </Link>
              </div>
            )}
          </div>

          <aside className="advisor-readout" aria-label="Measurement and telemetry data">
            {latestRecord ? (
              <>
                <div className="advisor-readout-heading">
                  <span>LATEST TELEMETRY READINGS</span>
                  <span className="advisor-readout-dot is-recorded" />
                </div>
                <time className="advisor-record-date">{formatRecordedDate(latestRecord)}</time>
                <div className="advisor-measurement-grid">
                  {assessmentMeasurementIds.map((id) => (
                    <div className="advisor-measurement" key={id}>
                      <span>{measurementLabels[id]}</span>
                      <strong>
                        {getAssessmentMeasurement(latestRecord, id)?.trim() ? (
                          <>
                            {getAssessmentMeasurement(latestRecord, id)}
                            <small> {measurementUnits[id]}</small>
                          </>
                        ) : (
                          "N/A"
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="advisor-readout-footer">
                  <small>Stored in SQLite database ({records.length} record{records.length === 1 ? "" : "s"})</small>
                </div>
              </>
            ) : (
              <div className="advisor-readout-empty">
                <span className="advisor-readout-empty-icon" aria-hidden="true">⌁</span>
                <span>NO TELEMETRY RECORDED TODAY</span>
                <small>
                  {records.length > 0
                    ? `Previous records (${records.length} logs) are preserved in the archive. Submit today's assessment to activate today's clinical telemetry.`
                    : "Submit an assessment to see recorded readings and AI diagnostic telemetry."}
                </small>
              </div>
            )}
          </aside>
        </section>

        {/* WHERE NEED TO FOCUS ON HEALTH (AI CLINICAL FOCUS AREAS) */}
        {aiAnalysis?.focus_areas && aiAnalysis.focus_areas.length > 0 && (
          <section className="advisor-focus-section" aria-labelledby="advisor-focus-title">
            <div className="advisor-section-heading">
              <div>
                <span className="advisor-overline">AI CLINICAL TRIAGE / IMMEDIATE HEALTH TARGETS</span>
                <h2 id="advisor-focus-title">WHERE NEED TO FOCUS ON HEALTH</h2>
              </div>
              <span className="advisor-heading-note">PRIORITY CLINICAL DIRECTIVES</span>
            </div>

            <div className="advisor-focus-grid">
              {aiAnalysis.focus_areas.map((item, idx) => (
                <div
                  key={idx}
                  className={`advisor-focus-card focus-priority-${item.priority.toLowerCase()}`}
                >
                  <div className="focus-card-top">
                    <span className="focus-card-area-name">{item.area}</span>
                    <span className={`focus-priority-pill pill-${item.priority.toLowerCase()}`}>
                      {item.priority} FOCUS
                    </span>
                  </div>

                  <div className="focus-target-box">
                    <span>CLINICAL TARGET</span>
                    <strong>{item.target}</strong>
                  </div>

                  <div className="focus-reason-box">
                    <span>WHY ATTENTION IS NEEDED</span>
                    <p>{item.reason}</p>
                  </div>

                  <div className="focus-action-box">
                    <span>WHAT TO DO NOW</span>
                    <p>{item.action}</p>
                  </div>

                  {item.sectionId && (
                    <Link
                      href={`/assessment?section=${item.sectionId}`}
                      className="focus-redirect-btn"
                    >
                      Log Updated Telemetry for {item.area} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI Prescribed Exercise Countermeasures */}
        {aiAnalysis?.exercises && aiAnalysis.exercises.length > 0 && (
          <section className="advisor-exercises-section" aria-labelledby="advisor-exercises-title">
            <div className="advisor-section-heading">
              <div>
                <span className="advisor-overline">AI CLINICAL PRESCRIPTION / MICROGRAVITY COUNTERMEASURES</span>
                <h2 id="advisor-exercises-title">PRESCRIBED COUNTERMEASURE EXERCISES</h2>
              </div>
              <span className="advisor-heading-note">GENERATED BY AI FLIGHT SURGEON</span>
            </div>

            <div className="advisor-exercises-grid">
              {aiAnalysis.exercises.map((ex, idx) => (
                <div className="advisor-exercise-card" key={idx}>
                  <div className="exercise-card-header">
                    <span className="exercise-number">0{idx + 1}</span>
                    <span className="exercise-badge">{ex.category || "AI PRESCRIBED"}</span>
                  </div>
                  <h3>{ex.name}</h3>
                  <div className="exercise-meta" style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "8px 0" }}>
                    <span className="exercise-duration-tag">⏱ {ex.duration}</span>
                    {ex.intensity && (
                      <span className="exercise-duration-tag" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.4)" }}>
                        ⚡ {ex.intensity}
                      </span>
                    )}
                  </div>
                  {ex.target && (
                    <div style={{ fontSize: "11px", color: "#67e8f9", marginBottom: "6px", fontFamily: "'Intel One Mono', monospace" }}>
                      🎯 Target: {ex.target}
                    </div>
                  )}
                  <p className="exercise-purpose-text">{ex.purpose}</p>
                  {ex.protocol && (
                    <div style={{ marginTop: "10px", padding: "8px 10px", background: "rgba(15, 23, 42, 0.6)", borderRadius: "6px", border: "1px dashed rgba(148, 163, 184, 0.25)" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "3px", letterSpacing: "0.5px" }}>
                        PROTOCOL INSTRUCTIONS:
                      </span>
                      <p style={{ margin: 0, fontSize: "12px", color: "#cbd5e1", lineHeight: "1.4" }}>{ex.protocol}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI Healthcare Suggestions & Countermeasure Protocols */}
        {aiAnalysis?.healthcare_suggestions && aiAnalysis.healthcare_suggestions.length > 0 && (
          <section className="advisor-suggestions-section" aria-labelledby="advisor-suggestions-title">
            <div className="advisor-section-heading">
              <div>
                <span className="advisor-overline">MISSION PROTOCOLS / FLIGHT SURGEON DIRECTIVES</span>
                <h2 id="advisor-suggestions-title">HEALTHCARE &amp; PHYSIOLOGICAL SUGGESTIONS</h2>
              </div>
              <span className="advisor-heading-note">PERSISTED IN DATABASE</span>
            </div>

            <div className="advisor-suggestions-list">
              {aiAnalysis.healthcare_suggestions.map((sug, idx) => (
                <div className="advisor-suggestion-item" key={idx}>
                  <span className="suggestion-bullet">✦</span>
                  <p>{sug}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section Domain Findings (All 6 Sections from DB) */}
        {aiAnalysis?.section_statuses && Object.keys(aiAnalysis.section_statuses).length > 0 && (
          <section className="advisor-domain-section" aria-labelledby="advisor-domain-title">
            <div className="advisor-section-heading">
              <div>
                <span className="advisor-overline">SIX-DOMAIN CLINICAL BREAKDOWN</span>
                <h2 id="advisor-domain-title">CLINICAL DOMAIN STATUS OVERVIEWS</h2>
              </div>
              <span className="advisor-heading-note">ANALYSIS BY DOMAIN</span>
            </div>

            <div className="advisor-domains-grid">
              {Object.entries(aiAnalysis.section_statuses).map(([secKey, secData]) => {
                const statusStr = secData.status || "Nominal";
                return (
                  <div
                    key={secKey}
                    className={`advisor-domain-card domain-status-${statusStr.toLowerCase()}`}
                  >
                    <div className="domain-card-top">
                      <h4>{sectionDisplayNames[secKey] || secKey}</h4>
                      <span className={`domain-status-pill pill-${statusStr.toLowerCase()}`}>
                        {statusStr.toUpperCase()}
                      </span>
                    </div>
                    <p className="domain-findings-text">{secData.findings}</p>
                    <Link
                      href={`/assessment?section=${secKey}`}
                      className="domain-redirect-link"
                    >
                      Update Domain Data →
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* General Astronaut Actions & Research */}
        <section className="advisor-actions-section" aria-labelledby="advisor-actions-title">
          <div className="advisor-section-heading">
            <div>
              <span className="advisor-overline">CREW OPERATIONAL WELL-BEING</span>
              <h2 id="advisor-actions-title">STANDARD WELL-BEING PROCEDURES</h2>
            </div>
            <span className="advisor-heading-note">NASA HRP EVIDENCE-BASED GUIDELINES</span>
          </div>
          <div className="advisor-actions-grid">
            {advisorRecommendedActions.map((action, index) => {
              const isSelected = selectedActionId === action.id;
              return (
                <button
                  className={`advisor-action-tile${isSelected ? " is-selected" : ""}`}
                  type="button"
                  key={action.id}
                  aria-expanded={isSelected}
                  aria-controls={isSelected ? "advisor-action-details" : undefined}
                  onClick={() =>
                    setSelectedActionId((current) => current === action.id ? null : action.id)
                  }
                >
                  <span className="advisor-action-number">0{index + 1}</span>
                  <span className="advisor-action-icon" aria-hidden="true">{action.icon}</span>
                  <strong>{action.title}</strong>
                  <span className="advisor-action-summary">{action.summary}</span>
                  <span className="advisor-action-schedule">{action.schedule}</span>
                  <span className="advisor-action-details">
                    {isSelected ? "CLOSE DETAILS" : "VIEW DETAILS"}
                    <i aria-hidden="true">{isSelected ? "−" : "↗"}</i>
                  </span>
                </button>
              );
            })}
          </div>
          {selectedAction && (
            <article className="advisor-action-expanded" id="advisor-action-details">
              <div>
                <span className="advisor-overline">{selectedAction.source}</span>
                <h3>{selectedAction.title}</h3>
              </div>
              <p>{selectedAction.details}</p>
            </article>
          )}
        </section>

        {/* Mission Scenarios Section */}
        <section className="advisor-scenarios-section" aria-labelledby="advisor-scenarios-title">
          <div className="advisor-section-heading">
            <div>
              <span className="advisor-overline">MISSION READINESS / WHAT-IF BRIEFINGS</span>
              <h2 id="advisor-scenarios-title">EXPLORE MISSION SCENARIOS</h2>
            </div>
            <span className="advisor-heading-note">SELECT A SCENARIO TO EXPLORE</span>
          </div>

          <div className="advisor-scenario-grid">
            {missionScenarios.map((scenario, index) => (
              <button
                className={`advisor-scenario-tile${selectedScenarioId === scenario.id ? " is-selected" : ""}`}
                type="button"
                key={scenario.id}
                aria-pressed={selectedScenarioId === scenario.id}
                onClick={() =>
                  setSelectedScenarioId((current) =>
                    current === scenario.id ? null : scenario.id,
                  )
                }
              >
                <span className="advisor-scenario-index">SCENARIO / 0{index + 1}</span>
                <span className="advisor-scenario-icon" aria-hidden="true">{scenario.icon}</span>
                <strong>{scenario.title}</strong>
                <span>{scenario.subtitle}</span>
                <i aria-hidden="true">{selectedScenarioId === scenario.id ? "−" : "↗"}</i>
              </button>
            ))}
          </div>

          {selectedScenario && (
            <article className="advisor-scenario-detail" aria-live="polite">
              <div className="advisor-scenario-detail-header">
                <div>
                  <span className="advisor-overline">MISSION SCENARIO / DETAIL BRIEF</span>
                  <h3>{selectedScenario.title}</h3>
                  <p>{selectedScenario.subtitle}</p>
                </div>
                <button
                  type="button"
                  className="advisor-close-button"
                  aria-label="Close scenario details"
                  onClick={() => setSelectedScenarioId(null)}
                >
                  ×
                </button>
              </div>

              <div className="advisor-scenario-detail-grid">
                <div>
                  <span className="advisor-detail-label">POSSIBLE EFFECTS</span>
                  <p>{selectedScenario.effects}</p>
                </div>
                <div>
                  <span className="advisor-detail-label">WHAT TO MONITOR</span>
                  <ul>
                    {selectedScenario.monitoring.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <span className="advisor-detail-label">PREVENTIVE GUIDANCE</span>
                  <ul>
                    {selectedScenario.preventiveMeasures.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <small>Follow current mission procedures; these notes are educational context.</small>
                </div>
                <div>
                  <span className="advisor-detail-label">WHEN TO REPORT</span>
                  <p>{selectedScenario.reporting}</p>
                </div>
              </div>
              <div className="advisor-scenario-research">
                <div>
                  <span className="advisor-detail-label">RESEARCH CONTEXT</span>
                  <p>{selectedScenario.researchContext}</p>
                </div>
                <span>{selectedScenario.guidanceSource}</span>
              </div>
            </article>
          )}
        </section>

        {/* Scientific References */}
        <details className="advisor-research">
          <summary>
            <span className="advisor-research-emblem" aria-hidden="true">R</span>
            <span>
              <span className="advisor-overline">REFERENCE LIBRARY</span>
              <strong>BEHIND THE SCIENCE</strong>
              <small>NASA Human Research Program &amp; flight surgeon clinical literature references.</small>
            </span>
            <i aria-hidden="true">+</i>
          </summary>
          <div className="advisor-research-content">
            {guidanceResearchItems.map((item) => (
              <article key={item.id}>
                <span>{item.source}</span>
                <h3>{item.title}</h3>
                <p>{item.finding}</p>
              </article>
            ))}
            <p className="advisor-research-disclaimer">
              NASA research and technical brief figures are references for professional astronaut operations, not a substitute for current mission protocols or flight surgeon directives.
            </p>
          </div>
        </details>

        <footer className="advisor-footer">
          <span>ASTRO CODE BLUE / HEALTH INTELLIGENCE</span>
          <span>PERSISTED TO SQLITE DATABASE · REAL-TIME AI TELEMETRY DISPATCH</span>
        </footer>
      </div>
    </main>
  );
}
