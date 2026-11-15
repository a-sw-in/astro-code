"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  HealthTrendCard,
  HealthLevel,
  MissionBackground,
  SleepChart,
  type HealthReading,
} from "./overview-panels";
import type { AssessmentRecord } from "../data/health-data";
import {
  parseStoredAssessments,
  toAssessmentRecord,
} from "../data/health-assessments";

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function OverviewDashboard() {
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [storageError, setStorageError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

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

      setRecords(parsed.records.map(toAssessmentRecord));

      if (parsed.invalidCount > 0) {
        setStorageError(
          `${parsed.invalidCount} invalid assessment record(s) were skipped.`
        );
      } else {
        setStorageError("");
      }
    } catch (error) {
      console.error("Error loading assessments:", error);
      setRecords([]);
      setStorageError(
        "Could not load assessments from backend (http://127.0.0.1:8000). Ensure the backend server is running."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(loadAssessments, 0);

    window.addEventListener("focus", loadAssessments);
    window.addEventListener("pageshow", loadAssessments);

    return () => {
      window.clearTimeout(initialLoad);
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

  // Filter records strictly for TODAY's calendar date
  const todayRecords = records.filter((r) => getRecordDayStr(r) === todayStr);
  const hasTodayData = todayRecords.length > 0;
  const hasData = records.length > 0;
  const latestToday = hasTodayData ? todayRecords[todayRecords.length - 1] : null;

  // Most recent past record (used only to display reference info if today has no record yet)
  const pastRecords = records.filter((r) => getRecordDayStr(r) !== todayStr);
  const mostRecentPastRecord = pastRecords.length > 0 ? pastRecords[pastRecords.length - 1] : null;

  // Today's active record to evaluate current vitals and AI
  const latest = latestToday;

  // Resolve daily cumulative metrics for today.
  let dailyTotalSleep: number | null = null;
  let dailyTotalWater: number | null = null;
  let dailyTotalExercise: number | null = null;

  if (hasTodayData && latest?.analysis?.daily_aggregates) {
    const da = latest.analysis.daily_aggregates;
    if (da.total_sleep !== undefined) dailyTotalSleep = da.total_sleep;
    if (da.total_water !== undefined) dailyTotalWater = da.total_water;
    if (da.total_exercise !== undefined) dailyTotalExercise = da.total_exercise;
  }

  // Frontend fallback: sum all today's records (session_increment stored in record fields)
  if (hasTodayData && (dailyTotalSleep === null || dailyTotalWater === null || dailyTotalExercise === null)) {
    let sumSleep = 0, sumWater = 0, sumExercise = 0;
    for (const r of todayRecords) {
      const s = parseFloat(r.sleepDuration?.trim() || "");
      if (Number.isFinite(s) && s > 0) sumSleep += s;

      const w = parseFloat(r.waterIntake?.trim() || "");
      if (Number.isFinite(w) && w > 0) sumWater += w;

      const e = parseFloat(r.exerciseDuration?.trim() || "");
      if (Number.isFinite(e) && e > 0) sumExercise += e;
    }
    if (dailyTotalSleep === null && sumSleep > 0) dailyTotalSleep = Math.round(sumSleep * 100) / 100;
    if (dailyTotalWater === null && sumWater > 0) dailyTotalWater = Math.round(sumWater * 100) / 100;
    if (dailyTotalExercise === null && sumExercise > 0) dailyTotalExercise = Math.round(sumExercise * 10) / 10;
  }

  const breakdown = latest?.analysis?.today_submissions_breakdown ?? latest?.analysis?.daily_aggregates?.submissions_breakdown;
  const sleepBreakdown = breakdown?.sleep?.sessions && breakdown.sleep.sessions.length > 1
    ? breakdown.sleep.sessions.map((s, idx) => `${idx === 0 ? "1st report" : `${idx + 1}nd submission`}: ${s.session_value}h`).join(" • ")
    : undefined;
  const waterBreakdown = breakdown?.water?.sessions && breakdown.water.sessions.length > 1
    ? breakdown.water.sessions.map((s, idx) => `${idx === 0 ? "1st report" : `${idx + 1}nd submission`}: ${s.session_value}L`).join(" • ")
    : undefined;
  const exerciseBreakdown = breakdown?.exercise?.sessions && breakdown.exercise.sessions.length > 1
    ? breakdown.exercise.sessions.map((s, idx) => `${idx === 0 ? "1st report" : `${idx + 1}nd submission`}: ${s.session_value}m`).join(" • ")
    : undefined;

  const displaySleep = dailyTotalSleep !== null ? String(Math.round(dailyTotalSleep * 10) / 10) : (hasTodayData && latest?.sleepDuration?.trim() ? latest.sleepDuration : "N/A");
  const displayWater = dailyTotalWater !== null ? String(Math.round(dailyTotalWater * 10) / 10) : (hasTodayData && latest?.waterIntake?.trim() ? latest.waterIntake : "N/A");
  const displayExercise = dailyTotalExercise !== null ? String(Math.round(dailyTotalExercise * 10) / 10) : (hasTodayData && latest?.exerciseDuration?.trim() ? latest.exerciseDuration : null);

  const readings: HealthReading[] = [
    {
      id: "heartRate",
      label: "Heart Rate",
      value: hasTodayData && latest?.heartRate?.trim() ? latest.heartRate : "N/A",
      unit: "BPM",
      glyph: "♡",
    },
    {
      id: "bloodPressure",
      label: "Blood Pressure",
      value:
        hasTodayData && latest?.systolic?.trim() && latest?.diastolic?.trim()
          ? `${latest.systolic}/${latest.diastolic}`
          : "N/A",
      unit: "mmHg",
      glyph: "⌁",
    },
    {
      id: "oxygenSaturation",
      label: "Oxygen Saturation",
      value: hasTodayData && latest?.oxygenSaturation?.trim() ? latest.oxygenSaturation : "N/A",
      unit: "%",
      glyph: "◉",
    },
    {
      id: "bodyTemperature",
      label: "Body Temperature",
      value: hasTodayData && latest?.bodyTemperature?.trim() ? latest.bodyTemperature : "N/A",
      unit: "°C",
      glyph: "♨",
    },
    {
      id: "hydration",
      label: todayRecords.length > 1 ? `Daily water intake (${todayRecords.length} logs)` : "Daily water intake",
      value: displayWater,
      unit: "L",
      glyph: "◌",
      breakdown: waterBreakdown,
    },
    {
      id: "sleep",
      label: todayRecords.length > 1 ? `Daily sleep (${todayRecords.length} logs)` : "Sleep duration",
      value: displaySleep,
      unit: "HRS",
      glyph: "◷",
      breakdown: sleepBreakdown,
    },
  ];

  if (displayExercise !== null && displayExercise !== "0") {
    readings.push({
      id: "exercise",
      label: todayRecords.length > 1 ? `Daily exercise (${todayRecords.length} logs)` : "Exercise countermeasure",
      value: displayExercise,
      unit: "MIN",
      glyph: "⚡",
      breakdown: exerciseBreakdown,
    });
  }

  return (
    <main className="content overview-page">
      <div className="overview-workspace">
        <MissionBackground />

        {storageError && (
          <p className="overview-storage-error" role="status">
            {storageError}
          </p>
        )}

        {!isLoading && !hasTodayData && (
          <div className="overview-no-data-banner">
            <div className="no-data-info">
              <div className="no-data-badge-row">
                <span className="no-data-status-dot" aria-hidden="true" />
                <span className="no-data-badge">NO TELEMETRY LOGGED TODAY ({todayFormatted})</span>
              </div>
              <h2>Today&apos;s Health Assessment Pending</h2>
              <p>
                {records.length > 0
                  ? `Previous mission records are archived (${records.length} logged prior to today). Submit today's health assessment to calculate current astronaut health levels, sleep analytics, and active flight surgeon directives.`
                  : "No health assessment data has been recorded in the database. Complete a health self-assessment to calculate astronaut health levels, sleep analytics, and telemetry trends."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/assessment" className="overview-primary-cta-btn">
                + Record Today&apos;s Assessment →
              </Link>
              {records.length > 0 && (
                <Link href="/past-records" className="overview-panel-action-btn">
                  View Past Records Archive ↗
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="overview-panels-row">
          <section
            className="glass-panel crew-profile-panel"
            aria-labelledby="crew-profile-title"
          >
            <div className="panel-header-with-action">
              <h1 className="panel-title" id="crew-profile-title">
                CREW PROFILE
              </h1>
              <Link href="/assessment" className="overview-mini-add-btn">
                + New Assessment
              </Link>
            </div>
            <div className="profile-identity">
              <div>
                <h2>Commander A. Morgan</h2>
                <p>
                  ASTRONAUT ID <strong>ACB-014</strong>
                </p>
              </div>
              <span className={`data-source${!hasTodayData ? " is-empty-tag" : ""}`}>
                {hasTodayData ? "TODAY'S ACTIVE TELEMETRY" : records.length > 0 ? "NO DATA TODAY" : "NO DATA FOUND"}
              </span>
            </div>
            <div className="profile-details">
              <div>
                <span>MISSION</span>
                <strong>ORBITAL HEALTH STUDY</strong>
              </div>
              <div>
                <span>TODAY'S LOGS</span>
                <strong>{hasTodayData ? `LOG #${todayRecords.length}` : "NO DATA TODAY"}</strong>
              </div>
              <div>
                <span>STATUS TODAY</span>
                <strong>
                  <i
                    className={`status-indicator${
                      !hasTodayData
                        ? " is-standby"
                        : latest?.analysis?.overall_health_status === "Critical"
                        ? " is-critical"
                        : latest?.analysis?.overall_health_status === "Caution"
                        ? " is-caution"
                        : ""
                    }`}
                  />
                  {hasTodayData && latest?.analysis?.overall_health_status
                    ? ` ${latest.analysis.overall_health_status.toUpperCase()}`
                    : " AWAITING TODAY'S LOG"}
                </strong>
              </div>
              <div>
                <span>LAST ASSESSMENT</span>
                <strong>
                  {hasTodayData && latest
                    ? formatTimestamp(new Date(latest.submittedAt))
                    : mostRecentPastRecord
                    ? `Archived: ${formatTimestamp(new Date(mostRecentPastRecord.submittedAt))}`
                    : "N/A"}
                </strong>
              </div>
            </div>
          </section>

          <section
            className="glass-panel health-level-panel"
            aria-labelledby="health-level-title"
          >
            <div className="health-heading">
              <h2 className="panel-title" id="health-level-title">
                HEALTH LEVEL
              </h2>
              <div className="panel-header-actions">
                <span className={`data-source${!hasData ? " is-empty-tag" : ""}`}>
                  {hasData ? "LATEST ASSESSMENT" : "NO DATA FOUND"}
                </span>
                <Link
                  href="/assessment?section=vitalSigns"
                  className="overview-mini-add-btn"
                  title="Record Vital Signs"
                >
                  + Add Vitals
                </Link>
              </div>
            </div>
            <HealthLevel readings={readings} />
            <div className="panel-action-footer">
              <p className="panel-footnote">
                {hasData
                  ? "Calculated from the most recent astronaut health assessment."
                  : "No vitals recorded in database. Enter assessment readings to calculate health level."}
              </p>
              <Link
                href="/assessment?section=vitalSigns"
                className="overview-panel-action-btn"
              >
                {hasData ? "Update Vital Signs →" : "+ Record Vital Signs →"}
              </Link>
            </div>
          </section>
        </div>

        <div className="overview-analytics-grid">
          <section
            className="glass-panel sleep-panel"
            aria-labelledby="sleep-panel-title"
          >
            <div className="sleep-summary">
              <div className="sleep-summary-heading">
                <h2 className="panel-title" id="sleep-panel-title">
                  SLEEP
                </h2>
                <div className="panel-header-actions">
                  <span className={`data-source${!hasTodayData ? " is-empty-tag" : ""}`}>
                    {hasTodayData ? "TODAY'S LOGGED SLEEP" : "NO SLEEP LOGGED TODAY"}
                  </span>
                  <Link
                    href="/assessment?section=sleepAndWellness"
                    className="overview-mini-add-btn"
                    title="Log Sleep & Hydration"
                  >
                    + Log
                  </Link>
                </div>
              </div>
              <p className="sleep-duration">
                {hasTodayData && displaySleep !== "—" && displaySleep !== "N/A" ? (
                  <>
                    {displaySleep}
                    <small> HRS</small>
                  </>
                ) : (
                  "N/A"
                )}
              </p>
              <p className="sleep-date">
                {hasTodayData
                  ? (todayRecords.length > 1
                      ? `Today's total sleep · ${todayRecords.length} sessions logged today`
                      : `Today's total sleep · ${formatTimestamp(new Date(latest!.submittedAt))}`)
                  : `No sleep logged today · Date: ${todayFormatted}`}
              </p>
              <div className="sleep-daily-detail">
                <span>LAST SLEEP ASSESSMENT</span>
                <strong>
                  {hasTodayData && latest?.sleepDuration?.trim()
                    ? `${latest.sleepDuration} HRS`
                    : mostRecentPastRecord?.sleepDuration?.trim()
                    ? `${mostRecentPastRecord.sleepDuration} HRS (Archived Past Record)`
                    : "N/A"}
                </strong>
                <small>
                  {hasTodayData && latest?.sleepDuration?.trim()
                    ? `Latest session logged today · ${formatTimestamp(new Date(latest!.submittedAt))}`
                    : mostRecentPastRecord?.sleepDuration?.trim()
                    ? `Logged on past date (${formatTimestamp(new Date(mostRecentPastRecord.submittedAt))})`
                    : "No sleep assessment recorded in database"}
                </small>
              </div>
              <div className="sleep-action-wrap">
                <Link
                  href="/assessment?section=sleepAndWellness"
                  className="overview-panel-action-btn"
                >
                  {hasTodayData ? "Update Today's Sleep & Wellness →" : "+ Log Today's Sleep & Wellness →"}
                </Link>
              </div>
            </div>

            <div className="sleep-chart-area">
              <div className="sleep-chart-heading">
                <div>
                  <h3>Sleep trend</h3>
                  <p>
                    {latest?.sleepDuration?.trim()
                      ? "Calculated from saved assessment history"
                      : "Awaiting sleep data from assessment"}
                  </p>
                </div>
                <span className="sleep-chart-unit">HOURS</span>
              </div>
              <SleepChart records={records} />
            </div>
          </section>

          <HealthTrendCard
            records={records}
            field="heartRate"
            label="HEART RATE"
            unit="BPM"
            color="#00d4ff"
            sectionId="vitalSigns"
            redirectLabel="+ Record Heart Rate"
          />
          <HealthTrendCard
            records={records}
            field="oxygenSaturation"
            label="OXYGEN SATURATION"
            unit="%"
            color="#168bff"
            sectionId="vitalSigns"
            redirectLabel="+ Record Oxygen"
          />
          <HealthTrendCard
            records={records}
            field="bloodPressure"
            label="BLOOD PRESSURE"
            unit="mmHg"
            color="#00d4ff"
            sectionId="vitalSigns"
            redirectLabel="+ Record Blood Pressure"
          />
          <HealthTrendCard
            records={records}
            field="waterIntake"
            label="DAILY WATER INTAKE"
            unit="L"
            color="#00d4ff"
            sectionId="sleepAndWellness"
            redirectLabel="+ Record Water Intake"
          />
          <HealthTrendCard
            records={records}
            field="bodyTemperature"
            label="BODY TEMPERATURE"
            unit="°C"
            color="#168bff"
            sectionId="vitalSigns"
            redirectLabel="+ Record Temperature"
          />
        </div>

        <section
          className="glass-panel health-insights-panel"
          aria-labelledby="health-insights-title"
        >
          <div className="health-insights-heading">
            <div>
              <span className="health-insights-kicker">
                CREW HEALTH / OBSERVATIONS &amp; ANALYSIS
              </span>
              <h2 id="health-insights-title">Health Insights</h2>
            </div>
            <div className="panel-header-actions">
              <span className={`health-insights-source${!hasData ? " is-empty-tag" : ""}`}>
                {hasData ? "CALCULATED FROM DATABASE" : "NO DATA FOUND"}
              </span>
              <Link href="/assessment" className="overview-mini-add-btn">
                + New Assessment
              </Link>
            </div>
          </div>
          <div className="health-insights-content">
            {latest ? (
              <div className="insights-active-content">
                <div className="insight-row">
                  <span className="insight-marker" aria-hidden="true">i</span>
                  <div>
                    <p className="insight-obs">
                      {latest.observations.trim()
                        ? latest.observations
                        : "No additional notes were included in the latest assessment."}
                    </p>
                    <small>
                      Observations recorded from assessment submitted at {formatTimestamp(new Date(latest.submittedAt))}.
                    </small>
                  </div>
                </div>

                {latest.analysis?.medical_alert && (
                  <div
                    className={`analysis-alert-box severity-${
                      latest.analysis.medical_alert.severity || "low"
                    }`}
                  >
                    <strong>
                      {latest.analysis.medical_alert.seek_medical_support
                        ? "⚠️ FLIGHT SURGEON MEDICAL CONSULTATION ADVISED"
                        : "✓ STATUS NOMINAL — NO MEDICAL CONSULTATION REQUIRED"}
                      {latest.analysis.medical_alert.severity
                        ? ` [${latest.analysis.medical_alert.severity.toUpperCase()} SEVERITY]`
                        : ""}
                    </strong>
                    {latest.analysis.medical_alert.advice && (
                      <p>{latest.analysis.medical_alert.advice}</p>
                    )}
                  </div>
                )}

                {latest.analysis?.exercises && latest.analysis.exercises.length > 0 && (
                  <div className="analysis-exercises-box" style={{ marginTop: "18px", padding: "16px 18px", background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(56, 189, 248, 0.3)", borderRadius: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                      <strong style={{ fontSize: "12px", color: "#38bdf8", letterSpacing: "1px", textTransform: "uppercase" }}>
                        ⚡ COMPLETE AI PRESCRIBED COUNTERMEASURE SUITE ({latest.analysis.exercises.length} PROTOCOLS)
                      </strong>
                      <Link href="/tasks" style={{ fontSize: "11px", color: "#38bdf8", textDecoration: "underline", fontWeight: 600 }}>
                        Track &amp; Log on Medical Tasks →
                      </Link>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                      {latest.analysis.exercises.map((ex, idx) => (
                        <div key={idx} style={{ background: "rgba(30, 41, 59, 0.55)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "8px", padding: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", fontWeight: 700 }}>
                              {ex.category || `PILLAR 0${idx + 1}`}
                            </span>
                            <span style={{ fontSize: "11px", color: "#f1f5f9", fontWeight: 700 }}>⏱ {ex.duration}</span>
                          </div>
                          <strong style={{ fontSize: "13px", color: "#f8fafc", display: "block", marginBottom: "4px" }}>{ex.name}</strong>
                          {ex.target && (
                            <span style={{ fontSize: "10px", color: "#67e8f9", display: "block", marginBottom: "4px", fontFamily: "'Intel One Mono', monospace" }}>
                              🎯 {ex.target}
                            </span>
                          )}
                          <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: "1.4" }}>{ex.purpose}</p>
                          {ex.protocol && (
                            <div style={{ marginTop: "6px", fontSize: "11px", color: "#cbd5e1", borderLeft: "2px solid #38bdf8", paddingLeft: "8px" }}>
                              {ex.protocol}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {latest.analysis?.healthcare_suggestions && latest.analysis.healthcare_suggestions.length > 0 && (
                  <div className="analysis-suggestions-box">
                    <strong>HEALTHCARE &amp; PHYSIOLOGICAL SUGGESTIONS</strong>
                    <ul>
                      {latest.analysis.healthcare_suggestions.map((sug, idx) => (
                        <li key={idx}>{sug}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {latest.analysis?.section_statuses && Object.keys(latest.analysis.section_statuses).length > 0 && (
                  <div className="analysis-sections-box">
                    <strong>CLINICAL DOMAIN STATUS OVERVIEWS (DATABASE PERSISTED)</strong>
                    <div className="overview-domain-status-grid">
                      {Object.entries(latest.analysis.section_statuses).map(([secKey, secData]) => {
                        const status = secData.status || "Nominal";
                        const sectionLabels: Record<string, string> = {
                          sleepAndWellness: "Sleep & Wellness",
                          vitalSigns: "Vital Signs",
                          cognitiveHealth: "Cognitive Health",
                          visionAndSymptoms: "Vision & SANS",
                          spaceEnvironment: "Space Environment",
                          specializedMedical: "Specialized Medical",
                        };
                        return (
                          <div
                            key={secKey}
                            className={`overview-domain-tile status-${status.toLowerCase()}`}
                          >
                            <div className="tile-top">
                              <span>{sectionLabels[secKey] || secKey}</span>
                              <span
                                className={`domain-badge badge-${status.toLowerCase()}`}
                              >
                                {status.toUpperCase()}
                              </span>
                            </div>
                            <p>{secData.findings}</p>
                            <Link
                              href={`/assessment?section=${secKey}`}
                              className="domain-link"
                            >
                              Update →
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {latest.analysis?.insights && latest.analysis.insights.length > 0 && (
                  <div className="analysis-insights-box">
                    <strong>CALCULATED HEALTH ANALYSIS ({latest.analysis.measurements_analyzed} measurements)</strong>
                    <ul>
                      {latest.analysis.insights.map((insight, idx) => (
                        <li key={idx}>{insight}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(() => {
                  const filteredChanges = (latest.analysis?.historical_changes || []).filter((change) => {
                    // Filter out false intra-day variations for cumulative metrics (sleep, water, exercise)
                    if (todayRecords.length > 1 && /sleep|water|exercise/i.test(change)) {
                      return false;
                    }
                    return true;
                  });
                  if (filteredChanges.length === 0) return null;
                  return (
                    <div className="analysis-changes-box">
                      <strong>HISTORICAL VARIATIONS DETECTED</strong>
                      <ul>
                        {filteredChanges.map((change, idx) => (
                          <li key={idx}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                <div className="insights-action-row">
                  <Link href="/assessment" className="overview-panel-action-btn">
                    + Add New Assessment →
                  </Link>
                  <Link href="/trends" className="overview-panel-action-btn">
                    View Health Trends →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="insights-empty-content">
                <span className="insight-marker is-empty-marker" aria-hidden="true">!</span>
                <div>
                  <p>
                    <strong>No assessment recorded for today ({todayFormatted}).</strong> Today&apos;s health insights, anomaly detection, AI flight surgeon evaluations, and daily countermeasure plans require an assessment recorded for today.
                  </p>
                  <small>
                    {records.length > 0
                      ? `Previous assessments are securely preserved in the archive (${records.length} historical records). Complete today's health assessment to update today's active health profile.`
                      : "Each section in the Health Assessment form calculates vital signs, sleep patterns, and environmental parameters for astronaut health tracking."}
                  </small>
                  <div className="insights-empty-actions">
                    <Link href="/assessment" className="overview-primary-cta-btn">
                      + Record Today&apos;s Assessment →
                    </Link>
                    {records.length > 0 && (
                      <Link href="/past-records" className="overview-panel-action-btn">
                        View Past Records Archive ↗
                      </Link>
                    )}
                    <Link href="/assessment?section=vitalSigns" className="overview-panel-action-btn">
                      Record Vitals →
                    </Link>
                    <Link href="/assessment?section=sleepAndWellness" className="overview-panel-action-btn">
                      Record Sleep →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <footer className="overview-footer">
          <span>ASTRO CODE BLUE <i>•</i> CREW HEALTH MONITORING</span>
          <span>
            {hasData
              ? `${records.length} ASSESSMENT RECORD(S) IN DATABASE`
              : "DATABASE EMPTY · NO TELEMETRY STORED"}
          </span>
        </footer>
      </div>
    </main>
  );
}
