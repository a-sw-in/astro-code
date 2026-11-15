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
    <main className="content past-records-page" style={{ padding: "24px 32px", maxWidth: "1600px", margin: "0 auto" }}>
      {/* Top Header */}
      <header style={{ marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", color: "#38bdf8", textTransform: "uppercase", display: "block", marginBottom: "4px" }}>
            HISTORICAL MISSION TELEMETRY ARCHIVE
          </span>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: 0, color: "#f8fafc", letterSpacing: "-0.5px" }}>
            PAST HEALTH RECORDS
          </h1>
          <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: "14px", maxWidth: "800px" }}>
            Select any past mission date to inspect comprehensive telemetry sessions, clinical domain evaluations, countermeasure prescriptions, and AI flight surgeon summaries.
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "8px", padding: "8px 16px", textAlign: "right" }}>
            <span style={{ fontSize: "10px", color: "#64748b", display: "block", fontWeight: 600 }}>DATES ARCHIVED</span>
            <strong style={{ fontSize: "18px", color: "#f1f5f9" }}>{dayGroups.length} DAYS</strong>
          </div>
          <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "8px", padding: "8px 16px", textAlign: "right" }}>
            <span style={{ fontSize: "10px", color: "#64748b", display: "block", fontWeight: 600 }}>TOTAL LOGS</span>
            <strong style={{ fontSize: "18px", color: "#38bdf8" }}>{structuredRecords.length} SESSIONS</strong>
          </div>
          <Link
            href="/assessment"
            className="overview-primary-cta-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              background: "linear-gradient(135deg, #0284c7, #0369a1)",
              color: "#fff",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: "0.5px",
              textDecoration: "none",
              border: "1px solid rgba(56, 189, 248, 0.4)",
            }}
          >
            + Record Today&apos;s Assessment
          </Link>
        </div>
      </header>

      {isLoading ? (
        <div style={{ padding: "60px", textAlign: "center", color: "#94a3b8" }}>
          <span style={{ display: "inline-block", width: "32px", height: "32px", border: "3px solid rgba(56, 189, 248, 0.2)", borderTopColor: "#38bdf8", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <p style={{ marginTop: "16px", fontSize: "14px" }}>Loading historical telemetry archive...</p>
        </div>
      ) : dayGroups.length === 0 ? (
        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px dashed rgba(148, 163, 184, 0.3)", borderRadius: "12px", padding: "48px", textAlign: "center" }}>
          <span style={{ fontSize: "36px", display: "block", marginBottom: "12px" }}>◫</span>
          <h2 style={{ fontSize: "20px", color: "#f8fafc", margin: "0 0 8px" }}>No Past Records Available</h2>
          <p style={{ color: "#94a3b8", fontSize: "14px", maxWidth: "540px", margin: "0 auto 20px" }}>
            No astronaut health assessments have been logged into the database yet. When assessments are completed, each calendar date will automatically archive here into separate cards.
          </p>
          <Link
            href="/assessment"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "#0284c7",
              color: "#fff",
              borderRadius: "6px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            + Log First Assessment
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
          {/* Left Column: Date List */}
          <aside style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "12px", padding: "16px", backdropFilter: "blur(8px)" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", display: "block", marginBottom: "12px" }}>
              SELECT MISSION DATE ({dayGroups.length})
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {dayGroups.map((group) => {
                const isSelected = group.dayKey === activeGroup?.dayKey;
                const statusColor =
                  group.overallStatus === "Critical" ? "#ef4444" : group.overallStatus === "Caution" ? "#f59e0b" : "#10b981";

                return (
                  <button
                    key={group.dayKey}
                    type="button"
                    onClick={() => {
                      setSelectedDayKey(group.dayKey);
                      setSelectedSessionIndex(group.rawRecords.length - 1);
                    }}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      background: isSelected ? "rgba(2, 132, 199, 0.2)" : "rgba(30, 41, 59, 0.4)",
                      border: isSelected ? "1px solid #38bdf8" : "1px solid rgba(148, 163, 184, 0.15)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      boxShadow: isSelected ? "0 0 12px rgba(56, 189, 248, 0.2)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "13px", color: isSelected ? "#38bdf8" : "#f1f5f9" }}>
                        {group.dateLabel}
                      </strong>
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: `${statusColor}22`,
                          color: statusColor,
                          border: `1px solid ${statusColor}44`,
                        }}
                      >
                        {group.overallStatus.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "#94a3b8" }}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {activeGroup && (
              <>
                {/* CARD 1: Day Overview & Session Progression */}
                <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(56, 189, 248, 0.3)", borderRadius: "12px", padding: "20px", backdropFilter: "blur(10px)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid rgba(148, 163, 184, 0.15)", paddingBottom: "14px", marginBottom: "16px" }}>
                    <div>
                      <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "1px", color: "#38bdf8", textTransform: "uppercase" }}>
                        MISSION ARCHIVE DATE
                      </span>
                      <h2 style={{ fontSize: "22px", fontWeight: 800, margin: "2px 0 0", color: "#f8fafc" }}>
                        {activeGroup.dateLabel}
                      </h2>
                    </div>

                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                        {activeGroup.rawRecords.length} submission{activeGroup.rawRecords.length > 1 ? "s" : ""} recorded on this date
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "4px 10px",
                          borderRadius: "6px",
                          background:
                            activeGroup.overallStatus === "Critical"
                              ? "rgba(239, 68, 68, 0.2)"
                              : activeGroup.overallStatus === "Caution"
                              ? "rgba(245, 158, 11, 0.2)"
                              : "rgba(16, 185, 129, 0.2)",
                          color:
                            activeGroup.overallStatus === "Critical"
                              ? "#ef4444"
                              : activeGroup.overallStatus === "Caution"
                              ? "#f59e0b"
                              : "#10b981",
                          border: "1px solid currentColor",
                        }}
                      >
                        STATUS: {activeGroup.overallStatus.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Day Cumulative Statistics Badges */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                    <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "8px", padding: "12px 14px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block", fontWeight: 600 }}>TOTAL SLEEP</span>
                      <strong style={{ fontSize: "22px", color: "#38bdf8", display: "block", marginTop: "2px" }}>
                        {activeGroup.totalSleep} <small style={{ fontSize: "12px", color: "#64748b" }}>HRS</small>
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "8px", padding: "12px 14px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block", fontWeight: 600 }}>TOTAL HYDRATION</span>
                      <strong style={{ fontSize: "22px", color: "#38bdf8", display: "block", marginTop: "2px" }}>
                        {activeGroup.totalWater} <small style={{ fontSize: "12px", color: "#64748b" }}>L</small>
                      </strong>
                    </div>

                    <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "8px", padding: "12px 14px" }}>
                      <span style={{ fontSize: "10px", color: "#94a3b8", display: "block", fontWeight: 600 }}>TOTAL EXERCISE</span>
                      <strong style={{ fontSize: "22px", color: "#38bdf8", display: "block", marginTop: "2px" }}>
                        {activeGroup.totalExercise} <small style={{ fontSize: "12px", color: "#64748b" }}>MINS</small>
                      </strong>
                    </div>
                  </div>

                  {/* Multi-Session Progression Breakdown (rendered ONLY when there are multiple sessions on this date) */}
                  {sessionProgression && (
                    <div style={{ background: "rgba(3, 14, 28, 0.7)", border: "1px solid rgba(56, 189, 248, 0.25)", borderRadius: "8px", padding: "12px 16px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", letterSpacing: "0.8px", display: "block", marginBottom: "6px" }}>
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
                    <div style={{ marginTop: "14px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>Inspect Session:</span>
                      {activeGroup.rawRecords.map((r, idx) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedSessionIndex(idx)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                            background: selectedSessionIndex === idx ? "#0284c7" : "rgba(30, 41, 59, 0.5)",
                            color: selectedSessionIndex === idx ? "#fff" : "#94a3b8",
                            border: selectedSessionIndex === idx ? "1px solid #38bdf8" : "1px solid rgba(148, 163, 184, 0.2)",
                          }}
                        >
                          Session #{idx + 1} ({formatTime(r.assessmentDate || r.submittedAt)})
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* CARD 2: Vital Signs Card */}
                <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "12px", padding: "20px" }}>
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
                </div>

                {/* CARD 3: Sleep, Circadian & Wellness Card */}
                <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "12px", padding: "20px" }}>
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
                </div>

                {/* CARD 4: Vision & Symptoms (SANS Neuro-Ocular Protocol) Card */}
                <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "12px", padding: "20px" }}>
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
                </div>

                {/* CARD 5: Space Environment Telemetry Card */}
                <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "12px", padding: "20px" }}>
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
                </div>

                {/* CARD 6: AI Flight Surgeon Evaluation & Prescriptions Card */}
                {activeAnalysis && (
                  <div style={{ background: "rgba(15, 23, 42, 0.75)", border: "1px solid rgba(56, 189, 248, 0.35)", borderRadius: "12px", padding: "20px" }}>
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
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
