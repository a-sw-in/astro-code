"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssessmentRecord } from "../data/health-data";

const STORAGE_KEY = "astro-code-blue-medical-tasks-state";
const STORAGE_VERSION = 4;

type TaskItem = {
  id: string;
  title: string;
  description: string;
  tag: string;
  category: "exercise" | "routine";
  durationOrSchedule?: string;
  source: string;
  actionUrl?: string;
};

const DEFAULT_EXERCISES: TaskItem[] = [
  {
    id: "ex-ared-heavy",
    title: "ARED Progressive Axial Skeletal Resistance Loading",
    description: "Axial skeletal deadlift and squat sets to counteract microgravity bone mineral density loss and maintain muscle mass.",
    tag: "RESISTANCE (75-80% 1RM)",
    category: "exercise",
    durationOrSchedule: "35 MINS",
    source: "NASA HRP Standard Countermeasure",
    actionUrl: "/assessment?section=sleepAndWellness",
  },
  {
    id: "ex-t2-treadmill",
    title: "T2 Treadmill Interval Aerobic Protocol",
    description: "Preserve plasma volume, cardiorespiratory endurance (VO2 peak), and provide ground reaction impact loading to long bones.",
    tag: "AEROBIC (INTERVALS)",
    category: "exercise",
    durationOrSchedule: "30 MINS",
    source: "NASA HRP Standard Countermeasure",
    actionUrl: "/assessment?section=sleepAndWellness",
  },
  {
    id: "ex-sans-decomp",
    title: "Cervico-Thoracic Posture & Cephalad Venous Outflow Decompression",
    description: "Targeted SANS mitigation to promote internal jugular venous drainage away from the optic nerve sheath and relieve intraocular pressure.",
    tag: "SANS CLINICAL TARGET",
    category: "exercise",
    durationOrSchedule: "15 MINS",
    source: "SANS Spaceflight Protocol",
    actionUrl: "/assessment?section=visionAndSymptoms",
  },
  {
    id: "ex-neuro-balance",
    title: "Columbus Sensorimotor Footbed & Vestibulo-Ocular Reflex (VOR) Routine",
    description: "Oculomotor gaze stabilization, otolith sensory reweighting, and plantar tactile mechanoreceptor stimulation against microgravity ataxia.",
    tag: "NEURO-VESTIBULAR",
    category: "exercise",
    durationOrSchedule: "15 MINS",
    source: "WinSCAT Sensorimotor Protocol",
    actionUrl: "/assessment?section=cognitiveHealth",
  },
  {
    id: "ex-vagal-recovery",
    title: "Diaphragmatic Vagal Autonomic Reset & Plantar Myofascial Release",
    description: "Accelerate post-workout cardiac autonomic recovery, lower sympathetic cortisol surge, and loosen plantar footbed fascia.",
    tag: "AUTONOMIC & RECOVERY",
    category: "exercise",
    durationOrSchedule: "10 MINS",
    source: "Behavioral Medicine Protocol",
    actionUrl: "/assessment?section=sleepAndWellness",
  },
];

const DEFAULT_ROUTINES: TaskItem[] = [
  {
    id: "rt-hydration",
    title: "Drink Water / Hydration Target (2.5–2.8 L)",
    description: "Consume 250ml electrolyte fluid every 90 minutes to mitigate cephalad fluid shifts and kidney stones.",
    tag: "HYDRATION",
    category: "routine",
    durationOrSchedule: "DAILY (2.8 L)",
    source: "Flight Surgeon Guideline",
    actionUrl: "/assessment?section=sleepAndWellness",
  },
  {
    id: "rt-vitals-check",
    title: "Check and Record Vital Signs",
    description: "Log Blood Pressure, Resting Heart Rate, Oxygen Saturation (SpO2), and Core Body Temp.",
    tag: "VITALS",
    category: "routine",
    durationOrSchedule: "TWICE DAILY",
    source: "Flight Telemetry Protocol",
    actionUrl: "/assessment?section=vitalSigns",
  },
  {
    id: "rt-sleep-schedule",
    title: "Sleep Block & Circadian Alignment",
    description: "7.5 hours scheduled sleep block; dim crew cabin lighting 45 minutes prior to sleep cycle.",
    tag: "CIRCADIAN",
    category: "routine",
    durationOrSchedule: "7.5 HRS BLOCK",
    source: "Behavioral Health Protocol",
    actionUrl: "/assessment?section=sleepAndWellness",
  },
  {
    id: "rt-cognitive-check",
    title: "Cognitive Alertness & Mood Self-Check",
    description: "Complete reaction time self-test and log subjective mood and concentration ratings.",
    tag: "COGNITIVE",
    category: "routine",
    durationOrSchedule: "DAILY CHECK",
    source: "WinSCAT Neuro Protocol",
    actionUrl: "/assessment?section=cognitiveHealth",
  },
  {
    id: "rt-vision-sans",
    title: "Visual Acuity & SANS Screening",
    description: "Perform Amsler grid self-check and report any blurred, distorted, or near-vision changes.",
    tag: "VISION / SANS",
    category: "routine",
    durationOrSchedule: "WEEKLY / AS NEEDED",
    source: "SANS Clinical Directive",
    actionUrl: "/assessment?section=visionAndSymptoms",
  },
];

function formatLocalDate(now: number) {
  if (!now) return "DATE SYNCING";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);
}

export default function MissionTasksDashboard() {
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [latestAssessment, setLatestAssessment] = useState<AssessmentRecord | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const [todayDateStr, setTodayDateStr] = useState<string>("");
  const [todayFormatted, setTodayFormatted] = useState<string>("");

  useEffect(() => {
    const d = new Date();
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setTodayDateStr(ds);
    setTodayFormatted(new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d));
  }, []);

  // Load saved completions from localStorage - auto-resets on a new calendar date!
  useEffect(() => {
    if (!todayDateStr) return;
    try {
      // Clear legacy storage keys
      window.localStorage.removeItem("astro-code-blue-tasks");
      window.localStorage.removeItem("astro-code-blue-mission-task-state");

      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Only restore tasks if they were completed TODAY and version matches
        if (parsed.version === STORAGE_VERSION && parsed.date === todayDateStr && Array.isArray(parsed.completed)) {
          setCompletedTaskIds(new Set(parsed.completed));
        } else {
          // New mission date, legacy schema or previous day: reset to uncompleted!
          setCompletedTaskIds(new Set());
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              version: STORAGE_VERSION,
              date: todayDateStr,
              completed: [],
            })
          );
        }
      } else {
        setCompletedTaskIds(new Set());
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            date: todayDateStr,
            completed: [],
          })
        );
      }
    } catch {}
    setIsLoaded(true);
  }, [todayDateStr]);

  // Sync current time
  useEffect(() => {
    const updateTime = () => setCurrentTime(Date.now());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Fetch latest assessment from backend SQLite database
  useEffect(() => {
    fetch("http://127.0.0.1:8000/assessments")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setLatestAssessment(data[data.length - 1]);
        }
      })
      .catch(() => {});
  }, []);

  const isTodayAssessment = useMemo(() => {
    if (!latestAssessment) return false;
    const d = latestAssessment.assessmentDate || latestAssessment.submittedAt;
    if (!d) return false;
    try {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}` === todayDateStr;
    } catch {
      return false;
    }
  }, [latestAssessment, todayDateStr]);

  // Merge default exercises with dynamic AI prescribed exercises from the database for TODAY
  const exerciseTasks = useMemo(() => {
    if (!isTodayAssessment) {
      return DEFAULT_EXERCISES;
    }
    const aiExercises = latestAssessment?.analysis?.exercises;
    if (Array.isArray(aiExercises) && aiExercises.length > 0) {
      return aiExercises.map((ex, idx) => ({
        id: `ai-ex-${idx}`,
        title: ex.name,
        description: ex.purpose + (ex.protocol ? ` • Protocol: ${ex.protocol}` : "") + (ex.target ? ` • Target: ${ex.target}` : ""),
        tag: ex.category?.toUpperCase() || ex.intensity?.toUpperCase() || "AI PRESCRIBED TODAY",
        category: "exercise" as const,
        durationOrSchedule: ex.duration?.toUpperCase() || "30 MINS",
        source: `AI Flight Surgeon Prescription [${ex.intensity || "Clinically Tailored"}]`,
        actionUrl: "/assessment?section=sleepAndWellness",
      }));
    }
    return DEFAULT_EXERCISES;
  }, [latestAssessment, isTodayAssessment]);

  // Merge default routines with dynamic flight surgeon recommendations from database for TODAY
  const routineTasks = useMemo(() => {
    const list = [...DEFAULT_ROUTINES];
    if (!isTodayAssessment) {
      return list;
    }
    const alert = latestAssessment?.analysis?.medical_alert;
    const da = latestAssessment?.analysis?.daily_aggregates;

    if (da) {
      const hydIndex = list.findIndex((t) => t.id === "rt-hydration");
      if (hydIndex !== -1 && da.total_water !== undefined) {
        list[hydIndex] = {
          ...list[hydIndex],
          title: `Drink Water / Hydration (${da.total_water} L / 2.5 L logged)`,
          description: `Today's logged hydration is ${da.total_water} L across logs. Target is 2.5–2.8 L. Consume 250ml electrolyte fluid every 90 minutes.`,
        };
      }

      const sleepIndex = list.findIndex((t) => t.id === "rt-sleep-schedule");
      if (sleepIndex !== -1 && da.total_sleep !== undefined) {
        list[sleepIndex] = {
          ...list[sleepIndex],
          title: `Sleep Schedule (${da.total_sleep} hrs / 7.5 hrs logged)`,
          description: `Today's accumulated sleep is ${da.total_sleep} hrs across daily logs. Maintain scheduled circadian rest.`,
        };
      }
    }

    if (alert?.seek_medical_support) {
      list.unshift({
        id: "rt-flight-surgeon-pmc",
        title: "⚠️ Consult Flight Surgeon (Private Medical Conference)",
        description: alert.advice || "Flight surgeon telemedicine review requested based on current astronaut telemetry.",
        tag: "URGENT CONSULT",
        category: "routine" as const,
        durationOrSchedule: "IMMEDIATE",
        source: `AI Medical Advisory [${alert.severity?.toUpperCase() || "HIGH"}]`,
        actionUrl: "/guidance",
      });
    }

    const suggestions = latestAssessment?.analysis?.healthcare_suggestions;
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      suggestions.slice(0, 2).forEach((sug, i) => {
        list.push({
          id: `ai-sug-${i}`,
          title: `AI Directive: ${sug.slice(0, 45)}...`,
          description: sug,
          tag: "AI SUGGESTION",
          category: "routine" as const,
          durationOrSchedule: "DAILY",
          source: "Persisted Database Protocol",
          actionUrl: "/guidance",
        });
      });
    }

    return list;
  }, [latestAssessment, isTodayAssessment]);

  const toggleTask = useCallback((taskId: string) => {
    setCompletedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            date: todayDateStr,
            completed: Array.from(next),
          }),
        );
      } catch {}
      return next;
    });
  }, [todayDateStr]);

  const resetCard1Tasks = useCallback(() => {
    setCompletedTaskIds((prev) => {
      const next = new Set(prev);
      for (const t of exerciseTasks) {
        next.delete(t.id);
      }
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            date: todayDateStr,
            completed: Array.from(next),
          }),
        );
      } catch {}
      return next;
    });
  }, [exerciseTasks, todayDateStr]);

  const resetCard2Tasks = useCallback(() => {
    setCompletedTaskIds((prev) => {
      const next = new Set(prev);
      for (const t of routineTasks) {
        next.delete(t.id);
      }
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            date: todayDateStr,
            completed: Array.from(next),
          }),
        );
      } catch {}
      return next;
    });
  }, [routineTasks, todayDateStr]);

  const resetAllTasks = useCallback(() => {
    setCompletedTaskIds(new Set());
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          date: todayDateStr,
          completed: [],
        }),
      );
    } catch {}
  }, [todayDateStr]);

  const totalTasks = exerciseTasks.length + routineTasks.length;
  const completedCount = useMemo(() => {
    let count = 0;
    for (const t of [...exerciseTasks, ...routineTasks]) {
      if (completedTaskIds.has(t.id)) count++;
    }
    return count;
  }, [completedTaskIds, exerciseTasks, routineTasks]);

  const progressPercent = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  return (
    <main className="content mission-operations-page">
      <div className="mission-operations-shell">
        <header className="operations-header">
          <div className="operations-title-group">
            <div className="operations-emblem" aria-hidden="true">
              <span>✦</span>
              <i />
            </div>
            <div>
              <p className="operations-eyebrow">ASTRO CODE BLUE / CLINICAL PROTOCOLS</p>
              <h1>MEDICAL TASKS &amp; PROTOCOLS</h1>
              <p className="operations-subtitle">
                Astronaut daily clinical checklist &amp; AI-prescribed countermeasure protocols.
              </p>
            </div>
          </div>
          <div className="operations-status">
            <span className="operations-status-light is-live" />
            <div>
              <span>MISSION TIME</span>
              <strong>{formatLocalDate(currentTime)}</strong>
            </div>
            <i>SQLITE TELEMETRY LINKED</i>
          </div>
        </header>

        {/* Top Progress & Readiness Panel */}
        <section className="operations-progress-panel" aria-labelledby="operations-progress-title">
          <div className="operations-progress-intro">
            <span className="operations-section-kicker">01 / CLINICAL PROTOCOL COMPLETION</span>
            <h2 id="operations-progress-title">DAILY MEDICAL READINESS</h2>
            <p>Track completion of prescribed countermeasure exercises and daily clinical routines.</p>
            <span className="operations-progress-caption">
              {isTodayAssessment
                ? "TASKS DERIVED FROM TODAY'S ASTRONAUT TELEMETRY & AI CLINICAL ENGINE"
                : `AWAITING TODAY'S LOGS (${todayFormatted}) · STANDARD BASELINE COUNTERMEASURES`}
            </span>
          </div>

          <div
            className="operations-progress-ring"
            style={{ "--mission-progress": `${progressPercent * 3.6}deg` } as React.CSSProperties}
            role="progressbar"
            aria-label="Daily medical task completion"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div>
              <strong>{isLoaded ? `${progressPercent}%` : "—"}</strong>
              <span>COMPLETE</span>
            </div>
          </div>

          <div className="operations-progress-stats">
            <div>
              <span>TASKS COMPLETE</span>
              <strong>
                {completedCount} <small>/ {totalTasks}</small>
              </strong>
            </div>
            <div>
              <span>EXERCISE STATUS</span>
              <strong>
                {exerciseTasks.every((t) => completedTaskIds.has(t.id)) ? "ALL DONE ✓" : "IN PROGRESS"}
              </strong>
            </div>
            <div>
              <span>ROUTINES LOGGED</span>
              <strong>
                {routineTasks.filter((t) => completedTaskIds.has(t.id)).length} <small>/ {routineTasks.length}</small>
              </strong>
            </div>
            <div>
              <span>QUICK ACTION</span>
              <button
                type="button"
                className="medical-reset-all-pill"
                onClick={resetAllTasks}
                title="Reset all tasks (both Card 01 and Card 02)"
              >
                ↺ Reset All Tasks
              </button>
            </div>
          </div>
        </section>

        {/* 2 MAIN CARDS: CARD 1 (EXERCISE) & CARD 2 (ROUTINE) */}
        <div className="medical-two-cards-grid">
          {/* CARD 1: EXERCISE COUNTERMEASURES */}
          <section className="medical-card-panel exercise-panel" aria-labelledby="exercise-card-title">
            <div className="medical-card-header">
              <div>
                <span className="operations-section-kicker">CARD 01 / PHYSICAL COUNTERMEASURES</span>
                <h2 id="exercise-card-title">PRESCRIBED EXERCISE COUNTERMEASURES</h2>
                <p>Targeted microgravity bone density, cardiorespiratory &amp; axial loading sessions.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span className="medical-card-badge">
                  {exerciseTasks.filter((t) => completedTaskIds.has(t.id)).length} / {exerciseTasks.length} DONE
                </span>
                <button
                  type="button"
                  onClick={resetCard1Tasks}
                  className="medical-card-reset-btn"
                  title="Reset Card 01 physical exercises"
                >
                  ↺ Reset Exercises
                </button>
              </div>
            </div>

            <div className="medical-card-tasks-list">
              {exerciseTasks.map((task) => {
                const isDone = completedTaskIds.has(task.id);
                return (
                  <div key={task.id} className={`medical-task-row${isDone ? " is-done" : ""}`}>
                    <div className="medical-task-info">
                      <div className="medical-task-title-line">
                        <strong>{task.title}</strong>
                        <span className="medical-task-pill">{task.durationOrSchedule}</span>
                        <span className="medical-task-pill">{task.tag}</span>
                      </div>
                      <p className="medical-task-desc">{task.description}</p>
                    </div>
                    <button
                      type="button"
                      className={`medical-task-action-btn${isDone ? " is-complete" : ""}`}
                      onClick={() => toggleTask(task.id)}
                    >
                      {isDone ? "✓ COMPLETED" : "MARK DONE"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="medical-card-footer">
              <span>SOURCE: AI CLINICAL ENGINE &amp; NASA HRP</span>
              <Link href="/assessment?section=sleepAndWellness" className="medical-link-btn">
                Log Exercise in Assessment →
              </Link>
            </div>
          </section>

          {/* CARD 2: DAILY CLINICAL & PHYSIOLOGICAL ROUTINES */}
          <section className="medical-card-panel routine-panel" aria-labelledby="routine-card-title">
            <div className="medical-card-header">
              <div>
                <span className="operations-section-kicker">CARD 02 / DAILY MEDICAL PROCEDURES</span>
                <h2 id="routine-card-title">DAILY CLINICAL &amp; HEALTH ROUTINES</h2>
                <p>Essential vital checks, target hydration volume, sleep rest &amp; neuro-vision screening.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span className="medical-card-badge">
                  {routineTasks.filter((t) => completedTaskIds.has(t.id)).length} / {routineTasks.length} DONE
                </span>
                <button
                  type="button"
                  onClick={resetCard2Tasks}
                  className="medical-card-reset-btn"
                  title="Reset Card 02 clinical routines"
                >
                  ↺ Reset Routines
                </button>
              </div>
            </div>

            <div className="medical-card-tasks-list">
              {routineTasks.map((task) => {
                const isDone = completedTaskIds.has(task.id);
                return (
                  <div key={task.id} className={`medical-task-row${isDone ? " is-done" : ""}`}>
                    <div className="medical-task-info">
                      <div className="medical-task-title-line">
                        <strong>{task.title}</strong>
                        <span className="medical-task-pill">{task.durationOrSchedule}</span>
                        <span className="medical-task-pill">{task.tag}</span>
                      </div>
                      <p className="medical-task-desc">{task.description}</p>
                    </div>
                    <button
                      type="button"
                      className={`medical-task-action-btn${isDone ? " is-complete" : ""}`}
                      onClick={() => toggleTask(task.id)}
                    >
                      {isDone ? "✓ COMPLETED" : "MARK DONE"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="medical-card-footer">
              <span>TARGETS: HYDRATION ≥ 2.8L • VITALS • SANS</span>
              <Link href="/assessment?section=vitalSigns" className="medical-link-btn">
                Log Vitals &amp; Hydration →
              </Link>
            </div>
          </section>
        </div>

        <footer className="operations-disclaimer">
          <span>ASTRO CODE BLUE / MEDICAL PROTOCOLS</span>
          <span>PERSISTED IN SQLITE DATABASE · REAL-TIME AI TELEMETRY DISPATCH</span>
        </footer>
      </div>
    </main>
  );
}
