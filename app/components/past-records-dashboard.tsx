"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssessmentRecord } from "../data/health-data";
import type { StructuredAssessmentRecord } from "../data/health-assessments";
import {
  parseStoredAssessments,
  toAssessmentRecord,
  ASSESSMENT_STORAGE_KEY,
} from "../data/health-assessments";

type DayRecordGroup = {
  dayKey: string;
  dateLabel: string;
  rawRecords: StructuredAssessmentRecord[];
  displayRecords: AssessmentRecord[];
  latestRecord: StructuredAssessmentRecord;
  totalSleep: number;
  totalWater: number;
  totalExercise: number;
  overallStatus: "Nominal" | "Caution" | "Critical";
};

function formatDisplayDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return dateStr;
  }
}

export default function PastRecordsDashboard() {
  const [structuredRecords, setStructuredRecords] = useState<StructuredAssessmentRecord[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState<string>("");
  const [selectedSessionIndex, setSelectedSessionIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const loadPastRecords = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg("");
    let loaded: StructuredAssessmentRecord[] = [];

    try {
      const res = await fetch("http://127.0.0.1:8000/assessments");
      if (res.ok) {
        const data = await res.json();
        const parsed = parseStoredAssessments(
          JSON.stringify({
            version: 2,
            records: data,
          })
        );
        loaded = parsed.records;
      }
    } catch (e) {
      console.warn("Backend fetch failed, trying local storage:", e);
    }

    if (loaded.length === 0 && typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(ASSESSMENT_STORAGE_KEY);
        if (saved) {
          const parsed = parseStoredAssessments(saved);
          loaded = parsed.records;
        }
      } catch (err) {
        console.warn("Local storage parse error:", err);
      }
    }

    setStructuredRecords(loaded);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadPastRecords();
  }, [loadPastRecords]);

  // Group assessments strictly by calendar day
  const dayGroups = useMemo<DayRecordGroup[]>(() => {
    const map = new Map<string, StructuredAssessmentRecord[]>();

    for (const r of structuredRecords) {
      const d = r.assessmentDate || r.submittedAt;
      if (!d) continue;
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) continue;
        const dayKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        if (!map.has(dayKey)) map.set(dayKey, []);
        map.get(dayKey)!.push(r);
      } catch {}
    }

    const groups: DayRecordGroup[] = [];

    for (const [dayKey, recs] of map.entries()) {
      // Sort sessions chronologically
      recs.sort((a, b) => {
        const tA = new Date(a.assessmentDate || a.submittedAt).getTime();
        const tB = new Date(b.assessmentDate || b.submittedAt).getTime();
        return tA - tB;
      });

      const latest = recs[recs.length - 1];
      const da = latest.analysis?.daily_aggregates;

      let totalSleep = da?.total_sleep ?? 0;
      let totalWater = da?.total_water ?? 0;
      let totalExercise = da?.total_exercise ?? 0;

      // Fallback calculation if aggregates missing
      if (!da) {
        for (const item of recs) {
          const sw = item.groups?.sleepAndWellness ?? {};
          const s = sw.sleepDuration?.value;
          const w = sw.waterIntake?.value;
          const e = sw.exerciseDuration?.value;
          if (s) totalSleep += parseFloat(String(s)) || 0;
          if (w) totalWater += parseFloat(String(w)) || 0;
          if (e) totalExercise += parseFloat(String(e)) || 0;
        }
      }

      totalSleep = Math.round(totalSleep * 10) / 10;
      totalWater = Math.round(totalWater * 10) / 10;
      totalExercise = Math.round(totalExercise * 10) / 10;

      const overallStatus = latest.analysis?.overall_health_status || "Nominal";

      groups.push({
        dayKey,
        dateLabel: formatDisplayDate(latest.assessmentDate || latest.submittedAt),
        rawRecords: recs,
        displayRecords: recs.map(toAssessmentRecord),
        latestRecord: latest,
        totalSleep,
        totalWater,
        totalExercise,
        overallStatus: overallStatus as "Nominal" | "Caution" | "Critical",
      });
    }

    // Sort newest date first
    groups.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
    return groups;
  }, [structuredRecords]);

  // Set default selected date once groups are computed
  useEffect(() => {
    if (dayGroups.length > 0 && (!selectedDayKey || !dayGroups.some((g) => g.dayKey === selectedDayKey))) {
      setSelectedDayKey(dayGroups[0].dayKey);
      setSelectedSessionIndex(dayGroups[0].rawRecords.length - 1);
    }
  }, [dayGroups, selectedDayKey]);

  const activeGroup = useMemo(() => {
    return dayGroups.find((g) => g.dayKey === selectedDayKey) || dayGroups[0] || null;
  }, [dayGroups, selectedDayKey]);

  const activeSessionRecord = useMemo(() => {
    if (!activeGroup || activeGroup.rawRecords.length === 0) return null;
    const idx = Math.min(Math.max(0, selectedSessionIndex), activeGroup.rawRecords.length - 1);
    return activeGroup.rawRecords[idx];
  }, [activeGroup, selectedSessionIndex]);

  const activeAnalysis = activeGroup?.latestRecord?.analysis || null;
  const groupsData = activeSessionRecord?.groups || activeGroup?.latestRecord?.groups || null;

  // Dynamically compute the chronological progression strictly from this active date's records
  const sessionProgression = useMemo(() => {
    if (!activeGroup || activeGroup.rawRecords.length <= 1) return null;

    const sleepParts: string[] = [];
    const waterParts: string[] = [];
    const exerciseParts: string[] = [];

    let totalSleep = 0;
    let totalWater = 0;
    let totalExercise = 0;

    activeGroup.rawRecords.forEach((r, idx) => {
      const ord =
        idx === 0
          ? "1st report"
          : idx === 1
          ? "2nd submission"
          : idx === 2
          ? "3rd submission"
          : `${idx + 1}th submission`;
      const timeStr = formatTime(r.assessmentDate || r.submittedAt);

      const sw = r.groups?.sleepAndWellness as
        | Record<string, { value?: unknown; session_increment?: unknown; raw_increment?: unknown }>
        | undefined;
      const sItem = sw?.sleepDuration;
      const sVal =
        parseFloat(String(sItem?.session_increment ?? sItem?.raw_increment ?? sItem?.value ?? "")) || 0;
      if (sVal > 0) {
        totalSleep += sVal;
        sleepParts.push(`${ord} (${timeStr}): ${sVal} hrs`);
      }

      const wItem = sw?.waterIntake;
      const wVal =
        parseFloat(String(wItem?.session_increment ?? wItem?.raw_increment ?? wItem?.value ?? "")) || 0;
      if (wVal > 0) {
        totalWater += wVal;
        waterParts.push(`${ord} (${timeStr}): ${wVal} L`);
      }

      const eItem = sw?.exerciseDuration;
      const eVal =
        parseFloat(String(eItem?.session_increment ?? eItem?.raw_increment ?? eItem?.value ?? "")) || 0;
      if (eVal > 0) {
        totalExercise += eVal;
        exerciseParts.push(`${ord} (${timeStr}): ${eVal} mins`);
      }
    });

    totalSleep = Math.round(totalSleep * 10) / 10;
    totalWater = Math.round(totalWater * 10) / 10;
    totalExercise = Math.round(totalExercise * 10) / 10;

    return {
      count: activeGroup.rawRecords.length,
      sleepText:
        sleepParts.length > 0
          ? `${sleepParts.join(", ")} -> Total sleep today: ${totalSleep} hrs`
          : "No sleep increments logged in these sessions.",
      waterText:
        waterParts.length > 0
          ? `${waterParts.join(", ")} -> Total water today: ${totalWater} L`
          : "No water increments logged in these sessions.",
      exerciseText:
        exerciseParts.length > 0
          ? `${exerciseParts.join(", ")} -> Total exercise today: ${totalExercise} mins`
          : "No exercise increments logged in these sessions.",
    };
  }, [activeGroup]);

  return (
    <main className="content past-records-page">
      {/* Top Header */}
      <header className="past-records-header">
        <div className="past-records-heading">
          <span className="past-records-kicker">
            HISTORICAL MISSION TELEMETRY ARCHIVE
          </span>
          <h1>
            PAST HEALTH RECORDS
          </h1>
          <p>
            Select any past mission date to inspect comprehensive telemetry sessions, clinical domain evaluations, countermeasure prescriptions, and AI flight surgeon summaries.
          </p>
        </div>

        <div className="past-records-header-actions">
          <div className="past-records-stat">
            <span>DATES ARCHIVED</span>
            <strong>{dayGroups.length} DAYS</strong>
          </div>
          <div className="past-records-stat is-highlighted">
            <span>TOTAL LOGS</span>
            <strong>{structuredRecords.length} SESSIONS</strong>
          </div>
          <Link
            href="/assessment"
            className="past-records-new-assessment"
          >
            + Record Today&apos;s Assessment
          </Link>
        </div>
      </header>

      {isLoading ? (
        <div className="past-records-loading">
          <span className="past-records-spinner" aria-hidden="true" />
          <p>Loading historical telemetry archive...</p>
        </div>
      ) : dayGroups.length === 0 ? (
        <div className="past-records-empty">
          <span className="past-records-empty-mark" aria-hidden="true">◫</span>
          <h2>No Past Records Available</h2>
          <p>
            No astronaut health assessments have been logged into the database yet. When assessments are completed, each calendar date will automatically archive here into separate cards.
          </p>
          <Link
            href="/assessment"
            className="past-records-empty-action"
          >
            + Log First Assessment
          </Link>
        </div>
      ) : (
        <div className="past-records-layout">
          {/* Left Column: Date List */}
          <aside className="past-records-date-panel">
            <span className="past-records-date-heading">
              SELECT MISSION DATE ({dayGroups.length})
            </span>
            <div className="past-records-date-list">
              {dayGroups.map((group) => {
                const isSelected = group.dayKey === activeGroup?.dayKey;
                const statusClass = group.overallStatus.toLowerCase();

                return (
                  <button
                    key={group.dayKey}
                    type="button"
                    className={`past-records-date-option${isSelected ? " is-active" : ""}`}
                    onClick={() => {
                      setSelectedDayKey(group.dayKey);
                      setSelectedSessionIndex(group.rawRecords.length - 1);
                    }}
                  >
                    <div className="past-records-date-option-heading">
                      <strong>
                        {group.dateLabel}
                      </strong>
                      <span className={`past-records-status-badge status-${statusClass}`}>
                        {group.overallStatus.toUpperCase()}
                      </span>
                    </div>
                    <div className="past-records-date-meta">
                      <span>◷ {group.totalSleep}h sleep</span>
                      <span>•</span>
                      <span>◌ {group.totalWater}L water</span>
                      <span>•</span>
                      <span>{group.rawRecords.length} log{group.rawRecords.length > 1 ? "s" : ""}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right Column: Separate Cards for the Selected Date */}
          <div className="past-records-detail-list">
            {activeGroup && (
              <>
                {/* CARD 1: Day Overview & Session Progression */}
                <section className="past-records-card past-records-day-card">
                  <div className="past-records-card-header">
                    <div>
                      <span className="past-records-card-kicker">
                        MISSION ARCHIVE DATE
                      </span>
                      <h2 className="past-records-date-title">
                        {activeGroup.dateLabel}
                      </h2>
                    </div>

                    <div className="past-records-day-meta">
                      <span className="past-records-submission-count">
                        {activeGroup.rawRecords.length} submission{activeGroup.rawRecords.length > 1 ? "s" : ""} recorded on this date
                      </span>
                      <span className={`past-records-overall-status status-${activeGroup.overallStatus.toLowerCase()}`}>
                        STATUS: {activeGroup.overallStatus.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Day Cumulative Statistics Badges */}
                  <div className="past-records-summary-grid">
                    <div className="past-records-summary-metric">
                      <span>TOTAL SLEEP</span>
                      <strong>
                        {activeGroup.totalSleep} <small style={{ fontSize: "12px", color: "#64748b" }}>HRS</small>
                      </strong>
                    </div>

                    <div className="past-records-summary-metric">
                      <span>TOTAL HYDRATION</span>
                      <strong>
                        {activeGroup.totalWater} <small style={{ fontSize: "12px", color: "#64748b" }}>L</small>
                      </strong>
                    </div>

                    <div className="past-records-summary-metric">
                      <span>TOTAL EXERCISE</span>
                      <strong>
                        {activeGroup.totalExercise} <small style={{ fontSize: "12px", color: "#64748b" }}>MINS</small>
                      </strong>
                    </div>
                  </div>

                  {/* Multi-Session Progression Breakdown (rendered ONLY when there are multiple sessions on this date) */}
                  {sessionProgression && (
                    <div className="past-records-progression">
                      <span className="past-records-card-kicker">
                        CHRONOLOGICAL SESSION PROGRESSION ON THIS DATE ({sessionProgression.count} SESSIONS)
                      </span>
                      <ul style={{ margin: 0, paddingLeft: "18px", color: "#e2e8f0", fontSize: "12px", lineHeight: "1.7" }}>
                        <li><strong>Sleep:</strong> {sessionProgression.sleepText}</li>
                        <li><strong>Hydration:</strong> {sessionProgression.waterText}</li>
                        <li><strong>Exercise:</strong> {sessionProgression.exerciseText}</li>
                      </ul>
                    </div>
                  )}

                  {/* Multi-session Inspector Tabs */}
                  {activeGroup.rawRecords.length > 1 && (
                    <div className="past-records-session-list">
                      <span>INSPECT SESSION</span>
                      {activeGroup.rawRecords.map((r, idx) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedSessionIndex(idx)}
                          className={`past-records-session-button${selectedSessionIndex === idx ? " is-active" : ""}`}
                        >
                          Session #{idx + 1} ({formatTime(r.assessmentDate || r.submittedAt)})
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {/* CARD 2: Vital Signs Card */}
                <section className="past-records-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px" }}>♡</span>
                      <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                        CARDIOVASCULAR &amp; VITAL SIGNS
                      </h3>
                    </div>
                    {groupsData?.vitalSigns && (
                      <span style={{ fontSize: "10px", color: "#64748b" }}>
                        Logged: {formatTime(activeSessionRecord?.assessmentDate || activeSessionRecord?.submittedAt || "")}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>HEART RATE</span>
                      <strong style={{ fontSize: "20px", color: "#f1f5f9" }}>
                        {groupsData?.vitalSigns?.heartRate?.value ? `${groupsData.vitalSigns.heartRate.value} BPM` : "N/A"}
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>BLOOD PRESSURE</span>
                      <strong style={{ fontSize: "20px", color: "#f1f5f9" }}>
                        {groupsData?.vitalSigns?.systolic?.value && groupsData?.vitalSigns?.diastolic?.value
                          ? `${groupsData.vitalSigns.systolic.value}/${groupsData.vitalSigns.diastolic.value} mmHg`
                          : "N/A"}
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>OXYGEN (SpO2)</span>
                      <strong style={{ fontSize: "20px", color: "#f1f5f9" }}>
                        {groupsData?.vitalSigns?.oxygenSaturation?.value ? `${groupsData.vitalSigns.oxygenSaturation.value} %` : "N/A"}
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>BODY TEMPERATURE</span>
                      <strong style={{ fontSize: "20px", color: "#f1f5f9" }}>
                        {groupsData?.vitalSigns?.bodyTemperature?.value ? `${groupsData.vitalSigns.bodyTemperature.value} °C` : "N/A"}
                      </strong>
                    </div>
                  </div>
                </section>

                {/* CARD 3: Sleep, Circadian & Wellness Card */}
                <section className="past-records-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px" }}>◷</span>
                      <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                        SLEEP, CIRCADIAN &amp; WELLNESS
                      </h3>
                    </div>
                    <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 600 }}>
                      Daily Total: {activeGroup.totalSleep} hrs
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>SESSION SLEEP</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.sleepAndWellness?.sleepDuration?.value ? `${groupsData.sleepAndWellness.sleepDuration.value} HRS` : "N/A"}
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>SLEEP QUALITY</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.sleepAndWellness?.sleepQuality?.value ? `${groupsData.sleepAndWellness.sleepQuality.value} / 5` : "N/A"}
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>FATIGUE LEVEL</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.sleepAndWellness?.fatigueLevel?.value ? `${groupsData.sleepAndWellness.fatigueLevel.value} / 5` : "N/A"}
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>STRESS RATING</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.sleepAndWellness?.stressLevel?.value ? `${groupsData.sleepAndWellness.stressLevel.value} / 5` : "N/A"}
                      </strong>
                    </div>
                  </div>
                </section>

                {/* CARD 4: Vision & Symptoms (SANS Neuro-Ocular Protocol) Card */}
                <section className="past-records-card">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                    <span style={{ fontSize: "16px" }}>👁️</span>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                      NEURO-OCULAR &amp; SELF-REPORTED SYMPTOMS
                    </h3>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "12px" }}>
                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>VISUAL ACUITY (LEFT)</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.visionAndSymptoms?.measurements?.visualAcuityLeft?.value ?? "1.0"}{" "}
                        <small style={{ fontSize: "11px", color: "#64748b" }}>decimal</small>
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>VISUAL ACUITY (RIGHT)</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.visionAndSymptoms?.measurements?.visualAcuityRight?.value ?? "1.0"}{" "}
                        <small style={{ fontSize: "11px", color: "#64748b" }}>decimal</small>
                      </strong>
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "8px" }}>
                      LOGGED SYMPTOMS:
                    </span>
                    {groupsData?.visionAndSymptoms?.symptoms && groupsData.visionAndSymptoms.symptoms.length > 0 ? (
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {groupsData.visionAndSymptoms.symptoms.map((s, idx) => {
                          const sName = typeof s === "object" ? s.symptom : String(s);
                          const sSev = typeof s === "object" ? s.severity : "moderate";
                          const sevBg = sSev === "severe" ? "#ef4444" : sSev === "moderate" ? "#f59e0b" : "#38bdf8";

                          return (
                            <span
                              key={idx}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 600,
                                background: `${sevBg}22`,
                                color: sevBg,
                                border: `1px solid ${sevBg}55`,
                              }}
                            >
                              {sName} · {sSev.toUpperCase()}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        ✓ No acute symptoms or visual disturbances reported on this date.
                      </span>
                    )}
                  </div>
                </section>

                {/* CARD 5: Space Environment Telemetry Card */}
                <section className="past-records-card">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                    <span style={{ fontSize: "16px" }}>🌌</span>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                      CABIN ENVIRONMENT &amp; HABITAT TELEMETRY
                    </h3>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>ATMOSPHERIC PRESSURE</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.spaceEnvironment?.cabinPressure?.value ?? "760"}{" "}
                        <small style={{ fontSize: "11px", color: "#64748b" }}>mmHg</small>
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>CARBON DIOXIDE</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.spaceEnvironment?.co2Concentration?.value ?? "0.3"}{" "}
                        <small style={{ fontSize: "11px", color: "#64748b" }}>%</small>
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>CABIN TEMP</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.spaceEnvironment?.ambientTemperature?.value ?? "21.5"}{" "}
                        <small style={{ fontSize: "11px", color: "#64748b" }}>°C</small>
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.4)", borderRadius: "8px", padding: "12px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>RADIATION DOSE</span>
                      <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>
                        {groupsData?.spaceEnvironment?.radiationDose?.value ?? "0.35"}{" "}
                        <small style={{ fontSize: "11px", color: "#64748b" }}>mGy/d</small>
                      </strong>
                    </div>
                  </div>
                </section>

                {/* CARD 6: AI Flight Surgeon Evaluation & Prescriptions Card */}
                {activeAnalysis && (
                  <section className="past-records-card past-records-ai-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "16px", color: "#38bdf8" }}>✦</span>
                        <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                          AI FLIGHT SURGEON CLINICAL EVALUATION FOR THIS DATE
                        </h3>
                      </div>
                      <span style={{ fontSize: "11px", color: "#38bdf8" }}>
                        Engine: {activeAnalysis.ai_status === "connected" ? "Qwen 2.5 AI Model" : "Flight Surgeon Rule Engine"}
                      </span>
                    </div>

                    <p style={{ fontSize: "14px", color: "#e2e8f0", lineHeight: "1.6", margin: "0 0 16px" }}>
                      {activeAnalysis.overall_summary || "Telemetry evaluated across parameters. Astronaut health stable within baseline thresholds."}
                    </p>

                    {/* Prescribed Countermeasure Exercises */}
                    {activeAnalysis.exercises && activeAnalysis.exercises.length > 0 && (
                      <div style={{ marginBottom: "18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1px", color: "#38bdf8", textTransform: "uppercase" }}>
                            PRESCRIBED COUNTERMEASURE PROTOCOLS ({activeAnalysis.exercises.length} PILLARS)
                          </span>
                          <span style={{ fontSize: "10px", color: "#64748b" }}>AI Flight Surgeon Regimen</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                          {activeAnalysis.exercises.map((ex, idx) => (
                            <div key={idx} style={{ background: "rgba(30, 41, 59, 0.55)", border: "1px solid rgba(56, 189, 248, 0.25)", borderRadius: "8px", padding: "14px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", fontWeight: 700 }}>
                                  {ex.category || `PILLAR 0${idx + 1}`}
                                </span>
                                <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700 }}>⏱ {ex.duration}</span>
                              </div>
                              <strong style={{ fontSize: "13px", color: "#f1f5f9", display: "block", marginBottom: "4px" }}>⚡ {ex.name}</strong>
                              {ex.target && (
                                <span style={{ fontSize: "10px", color: "#67e8f9", display: "block", marginBottom: "4px", fontFamily: "'Intel One Mono', monospace" }}>
                                  🎯 {ex.target}
                                </span>
                              )}
                              <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: "1.4" }}>{ex.purpose}</p>
                              {ex.protocol && (
                                <div style={{ marginTop: "8px", fontSize: "11px", color: "#cbd5e1", borderLeft: "2px solid #38bdf8", paddingLeft: "8px", background: "rgba(15, 23, 42, 0.4)", padding: "4px 8px" }}>
                                  {ex.protocol}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Clinical Suggestions */}
                    {activeAnalysis.healthcare_suggestions && activeAnalysis.healthcare_suggestions.length > 0 && (
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1px", color: "#38bdf8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                          PHYSIOLOGICAL &amp; OPERATIONAL DIRECTIVES
                        </span>
                        <ul style={{ margin: 0, paddingLeft: "18px", color: "#cbd5e1", fontSize: "13px", lineHeight: "1.6" }}>
                          {activeAnalysis.healthcare_suggestions.map((sug, idx) => (
                            <li key={idx} style={{ marginBottom: "4px" }}>{sug}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
