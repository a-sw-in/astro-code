import path from "node:path";
import fs from "node:fs";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";

export type SupportMessage = {
  id: string;
  sender: "user" | "ai" | "system";
  text: string;
  timestamp: string;
  isEscalation?: boolean;
  escalationReason?: string | null;
  escalationLink?: string | null;
};

export type SupportSessionRecord = {
  session_id: string;
  astronaut_id: string;
  created_at: string;
  ended_at: string | null;
  status: "ACTIVE" | "ENDED";
  chief_complaint: string;
  triage_level: "ROUTINE" | "ELEVATED" | "CRITICAL";
  escalated: boolean;
  escalation_reason: string | null;
  escalation_link: string;
  summary: string | null;
  key_recommendations: string[];
  messages: SupportMessage[];
};

const DB_PATH = path.join(process.cwd(), "backend", "astro_support.db");
const MEDICAL_DB_PATH = path.join(process.cwd(), "backend", "astro_code_blue.db");
const KAGGLE_URL_FILE = path.join(process.cwd(), "backend", "kaggle_url.txt");
export const DUMMY_SUPPORT_LINK =
  process.env.DUMMY_SUPPORT_LINK ||
  process.env.NEXT_PUBLIC_DUMMY_SUPPORT_LINK ||
  "https://www.google.com";

export type AstronautMedicalTelemetry = {
  date: string;
  heartRate?: string;
  bloodPressure?: string;
  oxygenSaturation?: string;
  bodyTemperature?: string;
  sleepDuration?: string;
  waterIntake?: string;
  exerciseDuration?: string;
  fatigueLevel?: string;
  stressLevel?: string;
  visualAcuity: string;
  symptoms: string[];
  cabinEnvironment: { co2?: string; pressure?: string; temp?: string; radiation?: string };
  overallStatus: string;
  overallSummary: string;
  medicalAlert?: string;
  prescribedExercises: Array<{
    name: string;
    duration: string;
    category?: string;
    purpose?: string;
    protocol?: string;
  }>;
  suggestions: string[];
  dailyAggregates?: {
    totalSleep?: number;
    totalWater?: number;
    totalExercise?: number;
    logCount?: number;
  };
};

/**
 * Directly queries the live astronaut medical assessment database (astro_code_blue.db).
 * Extracts latest vital signs, cumulative sleep/water/exercise, SANS status, cabin environment,
 * and AI flight surgeon prescriptions.
 */
export function getAstronautMedicalRecord(): AstronautMedicalTelemetry | null {
  try {
    if (!fs.existsSync(MEDICAL_DB_PATH)) return null;
    const db = new DatabaseSync(MEDICAL_DB_PATH, { readOnly: true });

    // Retrieve recent assessments to extract latest recorded biometrics
    const rows = db
      .prepare(`SELECT assessmentDate, submittedAt, groups, analysis FROM assessments ORDER BY datetime(assessmentDate) DESC, datetime(submittedAt) DESC, rowid DESC LIMIT 10`)
      .all() as any[];

    if (!rows || rows.length === 0) return null;

    const latestRow = rows[0];
    const latestAnalysis = typeof latestRow.analysis === "string" ? JSON.parse(latestRow.analysis) : latestRow.analysis || {};

    let heartRate: string | undefined;
    let bloodPressure: string | undefined;
    let oxygenSaturation: string | undefined;
    let bodyTemperature: string | undefined;
    let sleepDuration: string | undefined;
    let waterIntake: string | undefined;
    let exerciseDuration: string | undefined;
    let fatigueLevel: string | undefined;
    let stressLevel: string | undefined;
    let visualAcuity: string | undefined;
    const symptomsList: string[] = [];
    const envData: { co2?: string; pressure?: string; temp?: string; radiation?: string } = {};

    for (const r of rows) {
      try {
        const g = typeof r.groups === "string" ? JSON.parse(r.groups) : r.groups || {};
        const vs = g.vitalSigns || {};
        const sw = g.sleepAndWellness || {};
        const vis = g.visionAndSymptoms || {};
        const env = g.spaceEnvironment || {};

        if (!heartRate && vs.heartRate?.value) heartRate = `${vs.heartRate.value} BPM`;
        if (!bloodPressure && vs.systolic?.value && vs.diastolic?.value) {
          bloodPressure = `${vs.systolic.value}/${vs.diastolic.value} mmHg`;
        }
        if (!oxygenSaturation && vs.oxygenSaturation?.value) oxygenSaturation = `${vs.oxygenSaturation.value}%`;
        if (!bodyTemperature && vs.bodyTemperature?.value) bodyTemperature = `${vs.bodyTemperature.value} °C`;

        if (!sleepDuration && sw.sleepDuration?.value) sleepDuration = `${sw.sleepDuration.value} hrs`;
        if (!waterIntake && sw.waterIntake?.value) waterIntake = `${sw.waterIntake.value} L`;
        if (!exerciseDuration && sw.exerciseDuration?.value) exerciseDuration = `${sw.exerciseDuration.value} mins`;
        if (!fatigueLevel && sw.fatigueLevel?.value) fatigueLevel = `${sw.fatigueLevel.value} / 5`;
        if (!stressLevel && sw.stressLevel?.value) stressLevel = `${sw.stressLevel.value} / 5`;

        if (!visualAcuity && (vis.measurements?.visualAcuityLeft?.value || vis.measurements?.visualAcuityRight?.value)) {
          visualAcuity = `Left: ${vis.measurements?.visualAcuityLeft?.value ?? "1.0"}, Right: ${vis.measurements?.visualAcuityRight?.value ?? "1.0"}`;
        }

        if (Array.isArray(vis.symptoms) && symptomsList.length === 0) {
          for (const s of vis.symptoms) {
            if (typeof s === "string") symptomsList.push(s);
            else if (s && typeof s === "object") {
              symptomsList.push(`${s.symptom || "Symptom"} (${s.severity || "mild"})`);
            }
          }
        }

        if (!envData.co2 && env.co2Concentration?.value) envData.co2 = `${env.co2Concentration.value}%`;
        if (!envData.pressure && env.cabinPressure?.value) envData.pressure = `${env.cabinPressure.value} mmHg`;
        if (!envData.temp && env.ambientTemperature?.value) envData.temp = `${env.ambientTemperature.value} °C`;
        if (!envData.radiation && env.radiationDose?.value) envData.radiation = `${env.radiationDose.value} mGy/d`;
      } catch {}
    }

    const da = latestAnalysis.daily_aggregates || {};
    const exList = Array.isArray(latestAnalysis.exercises)
      ? latestAnalysis.exercises.map((e: any) => ({
          name: e.name || "Countermeasure Protocol",
          duration: e.duration || "20 mins",
          category: e.category || "Prescribed Protocol",
          purpose: e.purpose || "",
          protocol: e.protocol || "",
        }))
      : [];

    return {
      date: String(latestRow.assessmentDate || latestRow.submittedAt || "Today"),
      heartRate,
      bloodPressure,
      oxygenSaturation,
      bodyTemperature,
      sleepDuration: da.total_sleep !== undefined ? `${da.total_sleep} hrs (accumulated)` : sleepDuration,
      waterIntake: da.total_water !== undefined ? `${da.total_water} L (accumulated)` : waterIntake,
      exerciseDuration: da.total_exercise !== undefined ? `${da.total_exercise} mins (accumulated)` : exerciseDuration,
      fatigueLevel,
      stressLevel,
      visualAcuity: visualAcuity || "Left: 1.0, Right: 1.0 (Normal baseline)",
      symptoms: symptomsList,
      cabinEnvironment: envData,
      overallStatus: latestAnalysis.overall_health_status || "Nominal",
      overallSummary: latestAnalysis.overall_summary || "Telemetry evaluated across standard parameters.",
      medicalAlert: latestAnalysis.medical_alert?.advice || undefined,
      prescribedExercises: exList,
      suggestions: Array.isArray(latestAnalysis.healthcare_suggestions) ? latestAnalysis.healthcare_suggestions : [],
      dailyAggregates: {
        totalSleep: da.total_sleep,
        totalWater: da.total_water,
        totalExercise: da.total_exercise,
        logCount: da.log_count ?? rows.length,
      },
    };
  } catch (err) {
    console.warn("Could not read medical database:", err);
    return null;
  }
}

/**
 * Formats the live database telemetry into a clinical briefing string for the AI prompt.
 */
export function formatMedicalContextForPrompt(med: ReturnType<typeof getAstronautMedicalRecord>): string {
  if (!med) {
    return "DATABASE STATUS: No medical records found in astro_code_blue.db yet. Instruct the astronaut to record baseline telemetry in Health Assessment.";
  }

  const lines = [
    `=== ASTRONAUT ACB-014 LIVE MEDICAL TELEMETRY (FROM astro_code_blue.db) ===`,
    `Latest Telemetry Session: ${med.date}`,
    `Overall Health Status: ${med.overallStatus}`,
  ];

  if (med.heartRate || med.bloodPressure || med.oxygenSaturation || med.bodyTemperature) {
    lines.push(
      `Biometric Vitals: Heart Rate ${med.heartRate || "Awaiting entry"} | BP ${med.bloodPressure || "Awaiting entry"} | SpO2 ${med.oxygenSaturation || "Awaiting entry"} | Temp ${med.bodyTemperature || "Awaiting entry"}`
    );
  }

  lines.push(
    `Today's Accumulated Intakes: Sleep: ${med.dailyAggregates?.totalSleep ?? med.sleepDuration ?? "0 hrs"} (Daily target: 7.5h) | Water: ${med.dailyAggregates?.totalWater ?? med.waterIntake ?? "0 L"} (Daily target: 2.5–2.8L) | Exercise: ${med.dailyAggregates?.totalExercise ?? med.exerciseDuration ?? "0 mins"}`
  );

  if (med.fatigueLevel || med.stressLevel) {
    lines.push(`Self-Reported Wellness: Fatigue ${med.fatigueLevel || "Nominal"} | Stress ${med.stressLevel || "Nominal"}`);
  }

  if (med.symptoms.length > 0) {
    lines.push(`Logged Symptoms: ${med.symptoms.join(", ")}`);
  } else {
    lines.push(`Logged Symptoms: None reported (Zero acute symptoms)`);
  }

  lines.push(`SANS / Visual Acuity: ${med.visualAcuity}`);

  if (med.medicalAlert) {
    lines.push(`Active Flight Surgeon Medical Alert: ${med.medicalAlert}`);
  }

  if (med.prescribedExercises.length > 0) {
    lines.push(
      `AI Prescribed Countermeasures (${med.prescribedExercises.length} Protocols): ${med.prescribedExercises.map((e: { name: string; duration: string }, idx: number) => `${idx + 1}. ${e.name} [${e.duration}]`).join("; ")}`
    );
  }

  if (med.suggestions.length > 0) {
    lines.push(`Clinical Directives: ${med.suggestions.slice(0, 3).join(" | ")}`);
  }

  lines.push(`================================================================`);
  return lines.join("\n");
}

/**
 * Evaluates the live DB telemetry to determine if health conditions are concerning.
 * Returns severity: "nominal" | "caution" | "critical"
 * and a list of specific clinical flags found.
 */
export function assessHealthSeverity(med: AstronautMedicalTelemetry | null): {
  severity: "nominal" | "caution" | "critical";
  flags: string[];
  needsGroundSupport: boolean;
} {
  if (!med) return { severity: "nominal", flags: [], needsGroundSupport: false };

  const flags: string[] = [];
  let severity: "nominal" | "caution" | "critical" = "nominal";

  // Helper to escalate severity without downgrading
  const escalate = (level: "caution" | "critical") => {
    if (level === "critical") severity = "critical";
    else if (severity !== "critical") severity = "caution";
  };

  // --- Check overall status from DB analysis ---
  const statusLower = (med.overallStatus || "").toLowerCase();
  if (statusLower === "critical") {
    escalate("critical");
    flags.push(`Overall status flagged as CRITICAL by flight surgeon AI`);
  } else if (statusLower === "caution" || statusLower === "elevated" || statusLower === "warning") {
    escalate("caution");
    flags.push(`Overall status flagged as ${med.overallStatus}`);
  }

  // --- Vital Sign thresholds ---
  if (med.heartRate) {
    const hr = parseFloat(med.heartRate);
    if (!isNaN(hr)) {
      if (hr > 120 || hr < 40) { escalate("critical"); flags.push(`Heart Rate critically abnormal: ${med.heartRate}`); }
      else if (hr > 100 || hr < 50) { escalate("caution"); flags.push(`Heart Rate outside normal range: ${med.heartRate}`); }
    }
  }

  if (med.oxygenSaturation) {
    const spo2 = parseFloat(med.oxygenSaturation);
    if (!isNaN(spo2)) {
      if (spo2 < 90) { escalate("critical"); flags.push(`SpO₂ critically low: ${med.oxygenSaturation} (Critical threshold: <90%)`); }
      else if (spo2 < 94) { escalate("caution"); flags.push(`SpO₂ below optimal range: ${med.oxygenSaturation} (Target: ≥95%)`); }
    }
  }

  if (med.bodyTemperature) {
    const temp = parseFloat(med.bodyTemperature);
    if (!isNaN(temp)) {
      if (temp > 39.5 || temp < 35.0) { escalate("critical"); flags.push(`Body temperature critically abnormal: ${med.bodyTemperature}`); }
      else if (temp > 38.0 || temp < 36.0) { escalate("caution"); flags.push(`Body temperature outside normal range: ${med.bodyTemperature}`); }
    }
  }

  if (med.bloodPressure) {
    const bpMatch = med.bloodPressure.match(/(\d+)\/(\d+)/);
    if (bpMatch) {
      const sys = parseInt(bpMatch[1]), dia = parseInt(bpMatch[2]);
      if (sys > 180 || dia > 120 || sys < 70) { escalate("critical"); flags.push(`Blood pressure critically abnormal: ${med.bloodPressure}`); }
      else if (sys > 140 || dia > 90 || sys < 85) { escalate("caution"); flags.push(`Blood pressure outside nominal range: ${med.bloodPressure}`); }
    }
  }

  // --- Daily intakes ---
  const sleepVal = med.dailyAggregates?.totalSleep ?? (med.sleepDuration ? parseFloat(med.sleepDuration) : null);
  const waterVal = med.dailyAggregates?.totalWater ?? (med.waterIntake ? parseFloat(med.waterIntake) : null);

  if (sleepVal !== null && !isNaN(Number(sleepVal)) && Number(sleepVal) < 5.0) {
    escalate("caution");
    flags.push(`Severe sleep deficit: ${sleepVal} hrs (critical floor: 5h)`);
  }
  if (waterVal !== null && !isNaN(Number(waterVal)) && Number(waterVal) < 1.0) {
    escalate("caution");
    flags.push(`Severe dehydration risk: only ${waterVal} L logged (minimum: 1.0 L)`);
  }

  // --- Active symptoms ---
  if (med.symptoms && med.symptoms.length > 0) {
    const severeSymptoms = med.symptoms.filter((s) =>
      /(severe|critical|chest|vision loss|bleed|fracture|unconscious|seizure)/i.test(s)
    );
    if (severeSymptoms.length > 0) {
      escalate("critical");
      flags.push(`Severe symptoms on record: ${severeSymptoms.join(", ")}`);
    } else {
      escalate("caution");
      flags.push(`Active symptoms logged: ${med.symptoms.join(", ")}`);
    }
  }

  // --- Medical Alert ---
  if (med.medicalAlert) {
    escalate("caution");
    flags.push(`Active medical alert: ${med.medicalAlert}`);
  }

  const finalSeverity = severity as "nominal" | "caution" | "critical";
  const needsGroundSupport = finalSeverity === "critical" || finalSeverity === "caution";
  return { severity: finalSeverity, flags, needsGroundSupport };
}

/**
 * Formats a comprehensive, structured clinical health review from live DB data.
 * Used when astronaut asks "review my health data", "check my health", etc.
 */
export function formatComprehensiveHealthReview(med: AstronautMedicalTelemetry | null): string {
  if (!med) {
    return (
      `**📋 ASTRONAUT ACB-014 — HEALTH DATABASE REVIEW**\n\n` +
      `⚠️ **No medical records found in \`astro_code_blue.db\`.**\n\n` +
      `No assessment data has been logged yet. Please complete your first health entry in the [Health Assessment Portal](/assessment) to populate your medical record.\n\n` +
      `The AI will then provide a full clinical review based on your actual telemetry.`
    );
  }

  // --- Evaluate condition severity from live DB data ---
  const { severity, flags } = assessHealthSeverity(med);

  // --- Status badge ---
  const statusEmoji =
    severity === "critical" ? "🔴" : severity === "caution" ? "🟡" : "🟢";
  const overallLabel =
    severity === "critical" ? "CRITICAL — Immediate Action Required" :
    severity === "caution"  ? `CAUTION — ${med.overallStatus || "Elevated"}` :
    `Nominal — ${med.overallStatus || "Stable"}`;

  const lines: string[] = [
    `**📋 ASTRONAUT ACB-014 — COMPREHENSIVE HEALTH REVIEW**`,
    `*Source: \`astro_code_blue.db\` — Telemetry Session: ${med.date}*\n`,

    `${statusEmoji} **Overall Health Status: ${overallLabel}**`,
    med.overallSummary ? `*${med.overallSummary}*` : "",

    `\n---\n`,

    `**🫀 Biometric Vital Signs:**`,
    `- **Heart Rate**: ${med.heartRate || "N/A — not logged in this session"}`,
    `- **Blood Pressure**: ${med.bloodPressure || "N/A — not logged in this session"}`,
    `- **Oxygen Saturation (SpO₂)**: ${med.oxygenSaturation || "N/A — not logged in this session"}`,
    `- **Core Body Temperature**: ${med.bodyTemperature || "N/A — not logged in this session"}`,

    `\n---\n`,

    `**📊 Daily Cumulative Intakes:**`,
  ];

  const sleepVal = med.dailyAggregates?.totalSleep ?? (med.sleepDuration ? parseFloat(med.sleepDuration) : null);
  const waterVal = med.dailyAggregates?.totalWater ?? (med.waterIntake ? parseFloat(med.waterIntake) : null);
  const exVal = med.dailyAggregates?.totalExercise ?? (med.exerciseDuration ? parseFloat(med.exerciseDuration) : null);
  const logCount = med.dailyAggregates?.logCount ?? 1;

  if (sleepVal !== null && sleepVal !== undefined && !Number.isNaN(sleepVal)) {
    const sleepStatus = sleepVal >= 7.5 ? "✅ Target met" : sleepVal >= 6.5 ? "⚠️ Slightly below target" : "❌ Below target";
    lines.push(`- **Sleep**: **${sleepVal} hrs** across ${logCount} log(s) | Target: 7.5 hrs — ${sleepStatus}`);
  } else {
    lines.push(`- **Sleep**: N/A — not logged today`);
  }

  if (waterVal !== null && waterVal !== undefined && !Number.isNaN(waterVal)) {
    const waterStatus = waterVal >= 2.5 ? "✅ Target met" : "⚠️ Below target";
    lines.push(`- **Hydration**: **${waterVal} L** | Target: 2.5–2.8 L — ${waterStatus}`);
  } else {
    lines.push(`- **Hydration**: N/A — not logged today`);
  }

  if (exVal !== null && exVal !== undefined && !Number.isNaN(exVal)) {
    const exStatus = exVal >= 45 ? "✅ Target met" : "⚠️ Below target";
    lines.push(`- **Exercise**: **${exVal} mins** | Target: 45 mins — ${exStatus}`);
  } else {
    lines.push(`- **Exercise**: N/A — not logged today`);
  }

  if (med.fatigueLevel || med.stressLevel) {
    lines.push(`- **Fatigue Level**: ${med.fatigueLevel || "N/A"} | **Stress Level**: ${med.stressLevel || "N/A"}`);
  }

  lines.push(`\n---\n`);

  // SANS / Vision
  lines.push(
    `**👁️ SANS / Neuro-Ocular Status:**`,
    `- **Visual Acuity**: ${med.visualAcuity || "N/A"}`,
    `- **Active Symptoms**: ${med.symptoms && med.symptoms.length > 0 ? med.symptoms.join(", ") : "None reported"}`
  );

  // Cabin Environment
  const env = med.cabinEnvironment;
  if (env && (env.co2 || env.pressure || env.temp || env.radiation)) {
    lines.push(`\n---\n`);
    lines.push(
      `**🛸 Cabin Environment Telemetry:**`,
      `- **CO₂ Concentration**: ${env.co2 || "N/A"}`,
      `- **Cabin Pressure**: ${env.pressure || "N/A"}`,
      `- **Ambient Temperature**: ${env.temp || "N/A"}`,
      `- **Radiation Dose**: ${env.radiation || "N/A"}`
    );
  }

  lines.push(`\n---\n`);

  // Prescribed Exercises
  if (med.prescribedExercises && med.prescribedExercises.length > 0) {
    lines.push(`**🏋️ AI Prescribed Countermeasure Protocols (${med.prescribedExercises.length}):**`);
    med.prescribedExercises.forEach((e, i) => {
      lines.push(
        `${i + 1}. **${e.name}** (${e.duration})` +
          (e.category ? ` | *${e.category}*` : "") +
          (e.purpose ? `\n   - *Purpose*: ${e.purpose}` : "") +
          (e.protocol ? `\n   - *Protocol*: ${e.protocol}` : "")
      );
    });
  } else {
    lines.push(`**🏋️ Countermeasures:** N/A — Log an assessment to generate personalized protocols`);
  }

  // Flight Surgeon Directives
  if (med.suggestions && med.suggestions.length > 0) {
    lines.push(`\n---\n`);
    lines.push(`**🩺 Flight Surgeon Clinical Directives:**`);
    med.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }

  // Medical Alert
  if (med.medicalAlert) {
    lines.push(`\n---\n`);
    lines.push(`⚠️ **Active Medical Alert**: ${med.medicalAlert}`);
  }

  // --- Condition-triggered Ground Support Link (uses severity evaluated at top of function) ---
  if (severity === "critical") {
    lines.push(`\n---\n`);
    lines.push(
      `🚨 **CRITICAL HEALTH CONDITIONS DETECTED — IMMEDIATE GROUND SUPPORT REQUIRED**\n\n` +
      `The following clinical indicators require immediate Flight Surgeon intervention:\n` +
      flags.map((f) => `• ${f}`).join("\n") +
      `\n\n` +
      `**Immediate In-Flight Actions:**\n` +
      `1. Cease all physical countermeasure activities (ARED / CEVIS) immediately.\n` +
      `2. Move to tethered rest position in crew quarters.\n` +
      `3. Verify ppO₂ and ppCO₂ on the life support console.\n` +
      `4. Contact Ground Medical Control now:\n\n` +
      `👉 [**🆘 CONNECT TO FLIGHT SURGEON & GROUND SUPPORT TEAM**](${DUMMY_SUPPORT_LINK})`
    );
  } else if (severity === "caution") {
    lines.push(`\n---\n`);
    lines.push(
      `⚠️ **HEALTH CAUTION — ELEVATED MONITORING RECOMMENDED**\n\n` +
      `The following indicators are outside nominal parameters:\n` +
      flags.map((f) => `• ${f}`).join("\n") +
      `\n\n` +
      `Monitor closely and log a follow-up assessment. If symptoms worsen or you feel unwell, connect with Ground Support immediately:\n\n` +
      `👉 [**Connect to Flight Surgeon & Ground Support Team**](${DUMMY_SUPPORT_LINK})`
    );
  }

  lines.push(`\n---\n`);
  lines.push(
    `*All data sourced live from \`astro_code_blue.db\`. ` +
    `To update readings, visit the [Health Assessment Portal](/assessment).*`
  );

  return lines.filter((l) => l !== "").join("\n");
}

export function getKaggleUrl(): string {
  const envUrl = (
    process.env.KAGGLE_AI_URL ||
    process.env.NEXT_PUBLIC_KAGGLE_AI_URL ||
    ""
  ).trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  try {
    if (fs.existsSync(KAGGLE_URL_FILE)) {
      const val = fs.readFileSync(KAGGLE_URL_FILE, "utf-8").trim();
      if (val) return val.replace(/\/+$/, "");
    }
  } catch (err) {
    console.warn("Could not read kaggle_url.txt:", err);
  }
  return "";
}

export function setKaggleUrl(url: string): void {
  try {
    fs.writeFileSync(KAGGLE_URL_FILE, url.trim(), "utf-8");
  } catch (err) {
    console.error("Could not write kaggle_url.txt:", err);
  }
}

/**
 * Robustly extracts the clinical response text from arbitrary JSON returned by Kaggle AI.
 * Handles diverse formats (response, reply, text, message, content, choices, output, answer, result, etc.)
 */
export function extractResponseFromKaggleJson(data: any): string {
  if (!data) return "";

  if (typeof data === "string") {
    const trimmed = data.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const sub = extractResponseFromKaggleJson(parsed);
        if (sub) return sub;
      } catch {}
    }
    return trimmed;
  }

  if (Array.isArray(data)) {
    if (data.length > 0) return extractResponseFromKaggleJson(data[0]);
    return "";
  }

  if (typeof data === "object") {
    // 1. Direct standard keys
    const priorityKeys = [
      "response",
      "reply",
      "message",
      "text",
      "content",
      "output",
      "answer",
      "result",
      "clinical_response",
      "analysis",
      "generated_text",
    ];

    for (const key of priorityKeys) {
      const val = data[key];
      if (val) {
        if (typeof val === "string" && val.trim().length > 0) {
          return val.trim();
        }
        if (typeof val === "object") {
          const sub = extractResponseFromKaggleJson(val);
          if (sub) return sub;
        }
      }
    }

    // 2. Structured clinical fields from Kaggle /analyze endpoint
    const summaryParts: string[] = [];
    if (data.overall_summary && typeof data.overall_summary === "string") {
      summaryParts.push(data.overall_summary.trim());
    }
    if (data.medical_alert && typeof data.medical_alert === "object" && data.medical_alert.advice) {
      const adv = String(data.medical_alert.advice).trim();
      if (adv && !summaryParts.includes(adv)) {
        summaryParts.push(`**Clinical Advisory:** ${adv}`);
      }
    }
    if (Array.isArray(data.healthcare_suggestions) && data.healthcare_suggestions.length > 0) {
      const sugs = data.healthcare_suggestions
        .map((s: any) => `• ${String(s).trim()}`)
        .filter((s: string) => s.length > 2);
      if (sugs.length > 0) {
        summaryParts.push(`**Recommended Countermeasures:**\n${sugs.join("\n")}`);
      }
    }
    if (summaryParts.length > 0) {
      return summaryParts.join("\n\n");
    }

    // 3. OpenAI / vLLM style: choices[0].message.content
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const c = data.choices[0];
      if (c && typeof c === "object") {
        if (c.message && typeof c.message === "object" && c.message.content) {
          return String(c.message.content).trim();
        }
        if (c.text) {
          return String(c.text).trim();
        }
      }
    }

    // 3. Wrapper keys: data, body, payload
    for (const wrapper of ["data", "body", "payload"]) {
      if (data[wrapper] && typeof data[wrapper] === "object") {
        const nested = extractResponseFromKaggleJson(data[wrapper]);
        if (nested) return nested;
      }
    }

    // 4. Fallback: concatenate string values
    const stringParts = Object.values(data).filter(
      (v) => typeof v === "string" && (v as string).trim().length > 0
    ) as string[];
    if (stringParts.length > 0) return stringParts.join("\n\n");
  }

  return String(data);
}

/**
 * Connects to Kaggle AI (Qwen 2.5) via Cloudflare Tunnel, trying multiple endpoint candidates.
 * Extracts the clinical response text from the returned JSON.
 */
export async function queryKaggleAIChat(
  userMessage: string,
  history: SupportMessage[],
  customUrl?: string,
  medicalBriefing?: string
): Promise<{ reply: string; rawJson: any; endpoint: string } | null> {
  const rawBase = customUrl || getKaggleUrl();
  const baseUrl = rawBase.replace(/\/+$/, "");
  if (!baseUrl) return null;

  const medRecord = getAstronautMedicalRecord();
  const medicalContextStr = medicalBriefing || formatMedicalContextForPrompt(medRecord);

  const payload = {
    message: userMessage,
    prompt: userMessage,
    astronaut_id: "ACB-014",
    medical_telemetry: medicalContextStr,
    history: history.slice(-10).map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    })),
    system_instruction:
      "You are the ASTRO CODE BLUE Clinical Support & Medical Triage Assistant aboard an active space mission.\n" +
      "You evaluate astronaut symptoms, microgravity adaptation, and health status.\n" +
      "You have direct real-time read access to the astronaut's medical database (astro_code_blue.db):\n\n" +
      medicalContextStr +
      "\n\nIMPORTANT CLINICAL INSTRUCTIONS:\n" +
      "1. Maintain continuous conversational memory across all turns in this chat session. Remember what the astronaut told you in earlier messages.\n" +
      "2. Refer specifically to the astronaut's actual medical data from the database above when discussing vitals, sleep, hydration, exercise, or SANS symptoms.\n" +
      "3. If the astronaut asks to 'review my health', 'review my health data', 'check my health', 'health review', 'evaluate my health', or any similar phrase — ALWAYS provide a comprehensive clinical review using ONLY the live database telemetry above. Structure your response with sections: Overall Status, Vitals, Daily Intakes, SANS, Prescribed Countermeasures, and Directives. Use N/A for any missing values.\n" +
      "4. Never fabricate or guess values. Only use real data from the medical telemetry context provided above, or state N/A.\n" +
      "5. If an acute medical emergency is indicated, state that ground flight surgeon escalation is warranted.",
  };

  const endpointsToTry = [
    { url: `${baseUrl}/chat`, timeoutMs: 12000, isAnalyze: false },
    { url: `${baseUrl}/analyze`, timeoutMs: 15000, isAnalyze: true },
  ];

  for (const { url: ep, timeoutMs, isAnalyze } of endpointsToTry) {
    try {
      console.log(`[Support AI] Attempting Kaggle AI at: ${ep} (timeout ${timeoutMs}ms)`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const nowIso = new Date().toISOString();
      const bodyToSend = isAnalyze
        ? {
            raw_assessment: {
              id: `chat-${Date.now()}`,
              assessmentDate: nowIso,
              submittedAt: nowIso,
              assessmentNotes: `ASTRONAUT TELE-TRIAGE LIVE CHAT INQUIRY: ${userMessage}`,
              groups: {
                visionAndSymptoms: {
                  measurements: {},
                  symptoms: [
                    {
                      symptom: userMessage,
                      severity: "moderate",
                      recordedAt: nowIso,
                      source: "self_reported",
                      notes: `Submitted via tele-triage chat (Astronaut ACB-014)`,
                    },
                  ],
                },
                sleepAndWellness: {
                  sleepDuration: { value: 8.0, unit: "hours", recordedAt: nowIso, source: "self_reported" },
                  waterIntake: { value: 2.5, unit: "litres", recordedAt: nowIso, source: "self_reported" },
                  exerciseDuration: { value: 45, unit: "minutes", recordedAt: nowIso, source: "self_reported" },
                },
                cardiovascular: {
                  measurements: {
                    heartRate: { value: 72, unit: "BPM", recordedAt: nowIso, source: "device" },
                  },
                },
                respiratory: {
                  measurements: {
                    oxygenSaturation: { value: 98, unit: "%", recordedAt: nowIso, source: "device" },
                  },
                },
              },
            },
            message: userMessage,
            prompt: userMessage,
            astronaut_id: "ACB-014",
            daily_cumulative_context: {
              clinical_instruction:
                `ASTRONAUT LIVE CHAT TELE-TRIAGE CONSULTATION:\n` +
                `Astronaut ACB-014 reports: "${userMessage}".\n` +
                `Medical context from database: ${medicalContextStr}\n` +
                `Evaluate their symptoms and provide concise, practical clinical guidance for the crew.`,
            },
          }
        : payload;

      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "AstroCodeBlue/1.0",
        },
        body: JSON.stringify(bodyToSend),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const extracted = extractResponseFromKaggleJson(json);
        if (extracted && extracted.length > 0) {
          console.log(`[Support AI] Extracted response from Kaggle JSON (${extracted.length} chars) via ${ep}`);
          return {
            reply: extracted,
            rawJson: json,
            endpoint: ep,
          };
        }
      } else {
        console.warn(`[Support AI] Endpoint ${ep} returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.warn(`[Support AI] Could not reach endpoint ${ep}:`, err?.message || err);
    }
  }

  return null;
}

function getDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_chat_sessions (
      session_id TEXT PRIMARY KEY,
      astronaut_id TEXT DEFAULT 'ACB-014',
      created_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT DEFAULT 'ACTIVE',
      chief_complaint TEXT,
      triage_level TEXT DEFAULT 'ROUTINE',
      escalated INTEGER DEFAULT 0,
      escalation_reason TEXT,
      escalation_link TEXT DEFAULT 'https://www.google.com',
      summary TEXT,
      key_recommendations TEXT,
      messages TEXT
    );
  `);
  return db;
}

function getLocalTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function evaluateMedicalEscalation(text: string): {
  isEscalated: boolean;
  triageLevel: "ROUTINE" | "ELEVATED" | "CRITICAL";
  reason: string;
} {
  const lower = text.toLowerCase();

  const criticalKeywords = [
    /\b(chest pain|heart attack|angina|cardiac arrest|palpitations|arrhythmia)\b/,
    /\b(can'?t breathe|shortness of breath|dyspnea|suffocating|choking|hypoxia|low oxygen|spo2 < 90)\b/,
    /\b(loss of vision|blindness|papilledema|blurry vision|vision sudden|optic nerve|sans)\b/,
    /\b(decompression|bends|airlock malfunction|eva emergency|suit leak)\b/,
    /\b(severe burn|fracture|broken bone|hemorrhage|bleeding heavily|head trauma|concussion)\b/,
    /\b(carbon dioxide|co2 high|hypercapnia|toxic fumes|ammonia leak)\b/,
    /\b(radiation sickness|radiation alarm|dosimeter spike)\b/,
    /\b(unconscious|fainting|seizure|convulsion)\b/,
    /\b(call doctor|flight surgeon|connect with support|human help|emergency|talk to someone|ground medical)\b/,
  ];

  for (const regex of criticalKeywords) {
    const match = lower.match(regex);
    if (match) {
      return {
        isEscalated: true,
        triageLevel: "CRITICAL",
        reason: `Acute clinical indicator detected: '${match[0]}'. Immediate Flight Surgeon ground intervention indicated.`,
      };
    }
  }

  const elevatedKeywords = [
    /\b(severe headache|migraine|vertigo|dizziness|faint)\b/,
    /\b(motion sickness|vomit|vomiting|nausea|space adaptation|sas)\b/,
    /\b(insomnia|extreme fatigue|exhaustion|cannot sleep)\b/,
    /\b(muscle tear|joint pain|back pain|ared injury)\b/,
    /\b(fever|infection|rash|swelling)\b/,
    /\b(high blood pressure|hypertension|tachycardia)\b/,
  ];

  for (const regex of elevatedKeywords) {
    const match = lower.match(regex);
    if (match) {
      return {
        isEscalated: false,
        triageLevel: "ELEVATED",
        reason: `Elevated in-flight physiological symptom noted: '${match[0]}'.`,
      };
    }
  }

  return {
    isEscalated: false,
    triageLevel: "ROUTINE",
    reason: "Routine physiological inquiry or mission wellness discussion.",
  };
}

export function generateSupportAIReply(
  userMessage: string,
  history: SupportMessage[],
  kaggleExtractedText?: string,
  medRecord?: ReturnType<typeof getAstronautMedicalRecord>
): {
  reply: string;
  isEscalated: boolean;
  triageLevel: "ROUTINE" | "ELEVATED" | "CRITICAL";
  escalationReason: string | null;
  escalationLink: string | null;
  source: "kaggle_ai" | "local_protocol";
} {
  const evalResult = evaluateMedicalEscalation(userMessage);
  let isEscalated = evalResult.isEscalated;
  let triageLevel = evalResult.triageLevel;
  const reason = evalResult.reason;

  if (!isEscalated) {
    for (const msg of history) {
      if (msg.isEscalation) {
        isEscalated = true;
        if (triageLevel === "ROUTINE") triageLevel = "ELEVATED";
        break;
      }
    }
  }

  const lower = userMessage.toLowerCase();
  let reply = "";
  let source: "kaggle_ai" | "local_protocol" = "local_protocol";

  // Use live medical record from astro_code_blue.db if not passed directly
  const med = medRecord !== undefined ? medRecord : getAstronautMedicalRecord();

  // === SESSION CHAT MEMORY EXTRACTION ===
  // Extract context and symptoms discussed earlier in this session
  const previousUserMessages = history
    .filter((m) => m.sender === "user" && m.text.trim() !== userMessage.trim())
    .map((m) => m.text.toLowerCase());
  const fullSessionHistory = previousUserMessages.join(" ");

  const previouslyDiscussedVision = fullSessionHistory.includes("vision") || fullSessionHistory.includes("blur") || fullSessionHistory.includes("sans") || fullSessionHistory.includes("eye");
  const previouslyDiscussedSAS = fullSessionHistory.includes("nausea") || fullSessionHistory.includes("vomit") || fullSessionHistory.includes("sas") || fullSessionHistory.includes("motion");
  const previouslyDiscussedChest = fullSessionHistory.includes("chest") || fullSessionHistory.includes("heart") || fullSessionHistory.includes("pulse") || fullSessionHistory.includes("cardiac");
  const previouslyDiscussedSleep = fullSessionHistory.includes("sleep") || fullSessionHistory.includes("insomnia") || fullSessionHistory.includes("fatigue");
  const previouslyDiscussedMuscle = fullSessionHistory.includes("pain") || fullSessionHistory.includes("sore") || fullSessionHistory.includes("shoulder") || fullSessionHistory.includes("back") || fullSessionHistory.includes("knee");

  // If Kaggle LLM generated a reply via tunnel, use it
  if (kaggleExtractedText && kaggleExtractedText.trim().length > 0) {
    source = "kaggle_ai";
    const cleaned = kaggleExtractedText.trim();

    // Check DB condition severity — if bad, append ground support link even when Kaggle AI responds
    const dbCondition = assessHealthSeverity(med);
    if (dbCondition.severity === "critical") {
      isEscalated = true;
      triageLevel = "CRITICAL";
    } else if (dbCondition.severity === "caution" && triageLevel === "ROUTINE") {
      triageLevel = "ELEVATED";
    }

    if (isEscalated && triageLevel === "CRITICAL") {
      reply =
        `${cleaned}\n\n` +
        `🚨 **PRIORITY FLIGHT SURGEON ALERT TRIGGERED**\n` +
        `Ground Flight Surgeon intervention indicated: **${reason || dbCondition.flags.join("; ")}**\n\n` +
        `👉 [**CONNECT TO FLIGHT SURGEON & GROUND SUPPORT TEAM**](${DUMMY_SUPPORT_LINK})`;
    } else if (dbCondition.severity === "caution" && !cleaned.includes(DUMMY_SUPPORT_LINK)) {
      reply =
        `${cleaned}\n\n` +
        `⚠️ Some health indicators are outside nominal range. If you feel worse, connect with Ground Support:\n` +
        `👉 [**Connect to Flight Surgeon & Ground Support Team**](${DUMMY_SUPPORT_LINK})`;
    } else {
      reply = cleaned;
    }
  } else if (isEscalated && triageLevel === "CRITICAL") {
    reply =
      `🚨 **PRIORITY FLIGHT SURGEON ALERT TRIGGERED**\n\n` +
      `Your report indicates an acute physiological condition requiring immediate ground medical intervention: **${reason}**\n\n` +
      `**Immediate In-Flight Action Protocols:**\n` +
      `1. Cease all countermeasure physical loading (ARED / CEVIS) immediately.\n` +
      `2. Transition to calm tethered rest in your crew quarters.\n` +
      `3. Verify environmental partial pressures (ppO2 & ppCO2) on the life support console.\n` +
      `4. Direct flight surgeon downlink has been opened below. Click to connect immediately with Ground Medical Control:\n\n` +
      `👉 [**CONNECT TO FLIGHT SURGEON & GROUND SUPPORT TEAM**](${DUMMY_SUPPORT_LINK})`;
  }

  // === 0. COMPREHENSIVE HEALTH REVIEW — triggered by "review my health data" and variants ===
  else if (
    lower.includes("review my health") ||
    lower.includes("review health") ||
    lower.includes("check my health") ||
    lower.includes("health review") ||
    lower.includes("my health data") ||
    lower.includes("health data") ||
    lower.includes("evaluate my health") ||
    lower.includes("assess my health") ||
    lower.includes("full health") ||
    lower.includes("complete health") ||
    lower.includes("overall review") ||
    lower.includes("health report") ||
    lower.includes("medical review") ||
    lower.includes("check the db") ||
    lower.includes("check database") ||
    lower.includes("review db") ||
    lower.includes("check my record") ||
    lower.includes("review my record")
  ) {
    // Build the comprehensive review (already includes ground support link if conditions are bad)
    reply = formatComprehensiveHealthReview(med);

    // Also escalate the session triage level based on DB condition severity
    const dbCondition = assessHealthSeverity(med);
    if (dbCondition.severity === "critical") {
      isEscalated = true;
      triageLevel = "CRITICAL";
    } else if (dbCondition.severity === "caution" && triageLevel === "ROUTINE") {
      triageLevel = "ELEVATED";
    }
  }

  // === 1. REAL-TIME MEDICAL DATABASE: VITALS & BIOMETRIC TELEMETRY ===
  else if (
    lower.includes("vital") ||
    lower.includes("heart rate") ||
    lower.includes("pulse") ||
    lower.includes("blood pressure") ||
    lower.includes("bp") ||
    lower.includes("spo2") ||
    lower.includes("oxygen") ||
    lower.includes("temperature") ||
    lower.includes("biometric")
  ) {
    if (med && (med.heartRate || med.bloodPressure || med.oxygenSaturation || med.bodyTemperature)) {
      reply =
        `**Live Telemetry Retrieved from Medical Database (\`astro_code_blue.db\`):**\n\n` +
        `*Session Date: ${med.date}*\n` +
        `- **Heart Rate**: **${med.heartRate || "Awaiting entry today"}**\n` +
        `- **Blood Pressure**: **${med.bloodPressure || "Awaiting entry today"}**\n` +
        `- **Oxygen Saturation (SpO2)**: **${med.oxygenSaturation || "Awaiting entry today"}**\n` +
        `- **Core Body Temperature**: **${med.bodyTemperature || "Awaiting entry today"}**\n\n` +
        `**Clinical Flight Surgeon Interpretation:**\n` +
        `${med.overallStatus === "Nominal" ? "✓ All recorded biometrics reside safely within expected orbital baseline parameters." : `⚠️ Health Status: ${med.overallStatus}. ${med.medicalAlert || "Continue monitoring readings."}`}\n\n` +
        `Need to update your vitals? You can log a new reading directly in the [Health Assessment Portal](/assessment?section=vitalSigns).`;
    } else {
      reply =
        `**Medical Database Telemetry Status (\`astro_code_blue.db\`):**\n\n` +
        `No momentary vital readings (Heart Rate, BP, SpO2) are currently on file for today's active session.\n\n` +
        `**Recommended Action:**\n` +
        `Please attach your biometric bio-vest sensor or perform a manual cuff measurement in the [Health Assessment Portal](/assessment?section=vitalSigns).`;
    }
  }

  // === 2. REAL-TIME MEDICAL DATABASE: SLEEP, HYDRATION & RECOVERY ===
  else if (
    lower.includes("sleep") ||
    lower.includes("water") ||
    lower.includes("hydration") ||
    lower.includes("fluid") ||
    lower.includes("how much sleep") ||
    lower.includes("how much water") ||
    lower.includes("drink") ||
    lower.includes("insomnia") ||
    lower.includes("fatigue") ||
    lower.includes("tired")
  ) {
    const sleepVal = med?.dailyAggregates?.totalSleep ?? (med?.sleepDuration ? parseFloat(med.sleepDuration) : null);
    const waterVal = med?.dailyAggregates?.totalWater ?? (med?.waterIntake ? parseFloat(med.waterIntake) : null);
    const logCnt = med?.dailyAggregates?.logCount ?? 1;

    let dbSummary = `**Daily Intakes from Mission Database (\`astro_code_blue.db\`):**\n\n`;
    if (sleepVal !== null && sleepVal !== undefined && !Number.isNaN(sleepVal)) {
      dbSummary += `- **Today's Accumulated Sleep**: **${sleepVal} hrs** across ${logCnt} log(s) (Mission Target: **7.5 hrs**)\n`;
      if (sleepVal < 7.0) {
        const deficit = Math.round((7.5 - sleepVal) * 10) / 10;
        dbSummary += `  ↳ *Deficit: ${deficit} hrs remaining. A 30–45 min recovery nap is recommended before your next high-demand EVA/work shift.*\n`;
      } else {
        dbSummary += `  ↳ *✓ Sleep quota satisfied. Nominal circadian restorative sleep achieved.*\n`;
      }
    } else {
      dbSummary += `- **Sleep**: No sleep hours recorded yet today.\n`;
    }

    if (waterVal !== null && waterVal !== undefined && !Number.isNaN(waterVal)) {
      dbSummary += `- **Today's Accumulated Hydration**: **${waterVal} L** (Target: **2.5–2.8 L**)\n`;
      if (waterVal < 2.5) {
        const remWater = Math.round((2.5 - waterVal) * 10) / 10;
        dbSummary += `  ↳ *Fluid Deficit: Drink ${remWater} L more fluid to counteract microgravity hemoconcentration and kidney stone risk.*\n`;
      } else {
        dbSummary += `  ↳ *✓ Hydration volume requirement satisfied.*\n`;
      }
    } else {
      dbSummary += `- **Hydration**: No water volume recorded yet today.\n`;
    }

    reply =
      `${dbSummary}\n` +
      `**Circadian & Recovery Directives:**\n` +
      `- Dim cabin lighting to blue-depleted mode 45 minutes prior to scheduled sleep.\n` +
      `- Verify quarters ventilation fan speed ($\ge 0.08$ m/s) to avoid localized expired CO2 pockets.`;
  }

  // === 3. REAL-TIME MEDICAL DATABASE: PRESCRIBED EXERCISE COUNTERMEASURES ===
  else if (
    lower.includes("exercise") ||
    lower.includes("workout") ||
    lower.includes("countermeasure") ||
    lower.includes("ared") ||
    lower.includes("t2") ||
    lower.includes("cevis") ||
    lower.includes("training")
  ) {
    if (med && med.prescribedExercises.length > 0) {
      const exListText = med.prescribedExercises
        .map(
          (e: { name: string; duration: string; category?: string; purpose?: string; protocol?: string }, idx: number) =>
            `**${idx + 1}. ${e.name}** (${e.duration})\n   - *Category*: ${e.category || "Countermeasure"}\n   - *Purpose*: ${e.purpose || "Countermeasure routine"}${e.protocol ? `\n   - *Protocol*: ${e.protocol}` : ""}`
        )
        .join("\n\n");

      reply =
        `**Complete AI Prescribed Countermeasure Suite (\`astro_code_blue.db\`):**\n\n` +
        `${exListText}\n\n` +
        `**Flight Surgeon Operational Note:**\n` +
        `These protocols are dynamically calculated based on your current bone loading quota, SANS status, and heart rate telemetry. Track completions on the [Medical Tasks page](/tasks).`;
    } else {
      reply =
        `**Standard Countermeasure Baseline Protocol:**\n\n` +
        `1. **ARED Heavy Resistance Protocol** (35 mins) — Axial skeletal deadlift & squat sets against microgravity osteopenia.\n` +
        `2. **T2 Treadmill Interval Aerobic Protocol** (30 mins) — Cardiorespiratory volume & bone impact shocks.\n` +
        `3. **CEVIS Cycling Vascular Redistribution** (15 mins) — Mitigates cephalad venous fluid shift.\n` +
        `4. **Columbus Sensorimotor Footbed Protocol** (15 mins) — Balance & neuro-vestibular recovery.\n\n` +
        `*Log today's assessment to generate personalized prescriptions adapted to your biometrics.*`;
    }
  }

  // === 4. REAL-TIME MEDICAL DATABASE: SANS & NEURO-OCULAR STATUS ===
  else if (
    lower.includes("vision") ||
    lower.includes("blur") ||
    lower.includes("eye") ||
    lower.includes("sans") ||
    lower.includes("sight") ||
    lower.includes("acuity")
  ) {
    reply =
      `**SANS (Spaceflight-Associated Neuro-ocular Syndrome) Telemetry (\`astro_code_blue.db\`):**\n\n` +
      `- **Visual Acuity**: **${med?.visualAcuity || "Left: 1.0, Right: 1.0 (Normal decimal)"}**\n` +
      `- **Active Symptoms on Record**: ${med && med.symptoms.length > 0 ? med.symptoms.join(", ") : "None currently reported"}\n\n` +
      `**Clinical Mechanism & Flight Surgeon Directives:**\n` +
      `Microgravity headward fluid shifts displace venous blood and CSF toward the skull, elevating intracranial venous pressure and flattening the posterior globe.\n\n` +
      `**Prescribed Actions:**\n` +
      `1. Perform daily Amsler grid self-check in the [Medical Tasks module](/tasks).\n` +
      `2. Utilize Lower Body Negative Pressure (LBNP -25 mmHg) if optic disc blur is noted.\n` +
      `3. Avoid excessive Valsalva breath-holding during ARED resistance training.\n\n` +
      `👉 *If acute visual distortion or sudden blur occurs, connect immediately to ground:* [Flight Surgeon Emergency Link](${DUMMY_SUPPORT_LINK})`;
  }

  // === 5. REAL-TIME MEDICAL DATABASE: COMPLETE HEALTH STATUS & SUMMARY ===
  else if (
    lower.includes("health") ||
    lower.includes("status") ||
    lower.includes("condition") ||
    lower.includes("how am i") ||
    lower.includes("summary") ||
    lower.includes("my record") ||
    lower.includes("database") ||
    lower.includes("check me")
  ) {
    reply =
      `**Astronaut ACB-014 Comprehensive Medical Telemetry (\`astro_code_blue.db\`):**\n\n` +
      `*Evaluation Date: ${med?.date || "Current Mission Date"}*\n` +
      `- **Overall Health Status**: **${med?.overallStatus || "Nominal"}**\n` +
      `- **Vital Signs**: HR **${med?.heartRate || "Awaiting entry"}** | BP **${med?.bloodPressure || "Awaiting entry"}** | SpO2 **${med?.oxygenSaturation || "Awaiting entry"}**\n` +
      `- **Today's Cumulative Sleep**: **${med?.dailyAggregates?.totalSleep ?? med?.sleepDuration ?? "0"} hrs** (Goal: 7.5h)\n` +
      `- **Today's Cumulative Hydration**: **${med?.dailyAggregates?.totalWater ?? med?.waterIntake ?? "0"} L** (Goal: 2.8L)\n` +
      `- **Logged Symptoms**: ${med && med.symptoms.length > 0 ? med.symptoms.join(", ") : "Zero acute symptoms flagged"}\n` +
      `- **Active Prescriptions**: ${med && med.prescribedExercises.length > 0 ? `${med.prescribedExercises.length} tailored countermeasure protocols` : "Standard baseline countermeasures"}\n\n` +
      `*Everything is recorded and synchronized in the mission SQLite database.*`;
  }

  // === 6. CONVERSATION MEMORY: HANDLING FOLLOW-UP QUESTIONS ===
  else if (
    previousUserMessages.length > 0 &&
    (lower.includes("can i") ||
      lower.includes("is it safe") ||
      lower.includes("what about") ||
      lower.includes("should i") ||
      lower.includes("does it look") ||
      lower.includes("is that normal") ||
      lower.includes("getting worse") ||
      lower.includes("what next"))
  ) {
    let memoryContext = "";
    if (previouslyDiscussedVision) {
      memoryContext = `Regarding your earlier concern about **vision changes & SANS symptoms**: It is safe to perform submaximal CEVIS cycling, but avoid maximum 1RM Valsalva squats on ARED until your visual acuity test is verified.`;
    } else if (previouslyDiscussedSAS) {
      memoryContext = `Regarding your earlier report of **nausea & space motion sickness (SAS)**: Avoid sudden head rotations in pitch/yaw. Sip electrolyte fluids and defer heavy ARED loading until vestibular equilibrium stabilizes.`;
    } else if (previouslyDiscussedChest) {
      memoryContext = `Regarding your earlier report of **chest discomfort or elevated pulse**: Cease all physical exercise immediately and rest in your crew quarters. Immediate ground Flight Surgeon review is required.`;
    } else if (previouslyDiscussedMuscle) {
      memoryContext = `Regarding your earlier **musculoskeletal strain or pain**: Apply active stretching, decrease ARED canister resistance by 30%, and monitor for localized swelling.`;
    } else {
      memoryContext = `Continuing from our earlier discussion in this session: Your current overall health in the database is recorded as **${med?.overallStatus || "Nominal"}**.`;
    }

    reply =
      `**Session Context & Memory Follow-Up:**\n\n` +
      `${memoryContext}\n\n` +
      `Would you like to review specific biometric readings or connect with Ground Medical Control? [Connect to Ground Support](${DUMMY_SUPPORT_LINK})`;
  }

  // === 7. SPACE ADAPTATION SYNDROME (SAS) ===
  else if (
    lower.includes("motion sickness") ||
    lower.includes("nausea") ||
    lower.includes("vomit") ||
    lower.includes("sas")
  ) {
    reply =
      `**Space Adaptation Syndrome (SAS) Clinical Guidance:**\n\n` +
      `Neuro-vestibular sensory conflict is standard during early orbital adaptation and typically resolves within 48–72 mission hours.\n\n` +
      `**In-Flight Protocols:**\n` +
      `- Minimize rapid head pitch/yaw rotations.\n` +
      `- Focus your visual field on stationary, high-contrast cabin bulkheads.\n` +
      `- Sip electrolyte solution (100–150 ml per 30 minutes) to avoid microgravity dehydration.\n` +
      `- If acute nausea impairs mission duties, consult Flight Surgeon for oral/IM Promethazine authorization.\n\n` +
      `If symptoms worsen or you cannot retain fluids, connect with Ground Support: [Flight Surgeon Ground Link](${DUMMY_SUPPORT_LINK})`;
  }

  // === 8. GREETING & INTRO ===
  else if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
    reply =
      `Greetings Astronaut ACB-014. I am the **ASTRO CODE BLUE Clinical Support & Medical Triage Assistant**.\n\n` +
      `I am directly linked to your mission medical database (\`astro_code_blue.db\`). Current health status: **${med?.overallStatus || "Nominal"}**.\n\n` +
      `You can ask me about:\n` +
      `- Your latest **vital signs** (Heart Rate, BP, SpO2, Temp)\n` +
      `- Your **sleep and hydration** accumulated totals\n` +
      `- Your **AI-prescribed exercise countermeasures**\n` +
      `- SANS vision symptoms or space motion sickness (SAS)\n\n` +
      `How can I assist your mission wellness today?`;
  }

  // === 9. GENERAL CLINICAL FALLBACK ===
  else {
    reply =
      `**Telemetry & Mission Health Support Response:**\n\n` +
      `I have logged your message into the active mission tele-triage log (\`astro_support.db\`).\n\n` +
      `**Current Astronaut Overview from Database:**\n` +
      `- **Status**: ${med?.overallStatus || "Nominal"}\n` +
      `- **Today's Sleep**: ${med?.dailyAggregates?.totalSleep ?? med?.sleepDuration ?? "Awaiting log"}\n` +
      `- **Today's Hydration**: ${med?.dailyAggregates?.totalWater ?? med?.waterIntake ?? "Awaiting log"}\n\n` +
      `If you are experiencing any acute symptoms or feel ground medical review is warranted, connect directly here: [Connect to Flight Surgeon Support](${DUMMY_SUPPORT_LINK})`;
  }

  const linkNeeded =
    isEscalated ||
    lower.includes("doctor") ||
    lower.includes("support") ||
    lower.includes("flight surgeon") ||
    lower.includes("help team");

  return {
    reply,
    isEscalated,
    triageLevel,
    escalationReason: isEscalated ? reason : null,
    escalationLink: linkNeeded ? DUMMY_SUPPORT_LINK : null,
    source,
  };
}

export function generateSessionSummary(messages: SupportMessage[]): {
  chiefComplaint: string;
  triageLevel: "ROUTINE" | "ELEVATED" | "CRITICAL";
  escalated: boolean;
  escalationReason: string | null;
  escalationLink: string | null;
  summary: string;
  keyRecommendations: string[];
} {
  const userTexts = messages.filter((m) => m.sender === "user").map((m) => m.text);
  const hadEscalation = messages.some((m) => m.isEscalation);
  let triageLevel: "ROUTINE" | "ELEVATED" | "CRITICAL" = hadEscalation ? "CRITICAL" : "ROUTINE";
  let escalationReason: string | null = null;

  for (const m of messages) {
    if (m.isEscalation) {
      triageLevel = "CRITICAL";
      escalationReason = m.escalationReason || "Acute medical condition flagged during conversation.";
      break;
    }
  }

  if (!hadEscalation) {
    for (const t of userTexts) {
      const ev = evaluateMedicalEscalation(t);
      if (ev.triageLevel === "ELEVATED") {
        triageLevel = "ELEVATED";
        escalationReason = ev.reason;
      }
    }
  }

  let chiefComplaint = "General In-Flight Wellness Consultation";
  if (userTexts.length > 0) {
    const first = userTexts[0].trim();
    chiefComplaint = first.length > 60 ? first.slice(0, 57) + "..." : first;
  }

  let keyRecommendations: string[] = [];
  if (hadEscalation) {
    keyRecommendations = [
      "Immediate Ground Flight Surgeon consultation requested via secure medical telemetry link (www.google.com).",
      "Halt strenuous countermeasure routines (ARED/CEVIS) until clinical clearance is obtained.",
      "Record serial vital signs every 15 minutes and log any new neurological or visual symptoms.",
    ];
  } else if (triageLevel === "ELEVATED") {
    keyRecommendations = [
      "Maintain symptom diary and monitor for symptom progression over the next 12 hours.",
      "Adjust hydration and rest schedules according to orbital flight protocols.",
      "Schedule follow-up assessment with medical telemetry officer.",
    ];
  } else {
    keyRecommendations = [
      "Continue standard mission wellness, nutrition, and exercise countermeasure schedules.",
      "Log daily vitals and cumulative hydration in the Health Assessment portal.",
    ];
  }

  const summary =
    `Session completed with ${messages.length} total messages. ` +
    `Chief topic: '${chiefComplaint}'. ` +
    `Triage status assessed as ${triageLevel}. ` +
    `${
      hadEscalation
        ? "Flight Surgeon escalation link (www.google.com) was provided to crew."
        : "Symptom management provided in-cabin with no acute flight surgeon escalation required."
    }`;

  return {
    chiefComplaint,
    triageLevel,
    escalated: hadEscalation,
    escalationReason,
    escalationLink: hadEscalation ? DUMMY_SUPPORT_LINK : null,
    summary,
    keyRecommendations,
  };
}

// Database CRUD operations
export function createNewSession(astronautId = "ACB-014"): SupportSessionRecord {
  const db = getDb();
  const sessionId = `SES-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  const nowStr = getLocalTimestamp();

  const welcomeMsg: SupportMessage = {
    id: `msg-${Math.random().toString(36).substring(2, 8)}`,
    sender: "ai",
    text:
      "Greetings Astronaut ACB-014. I am the ASTRO CODE BLUE Clinical Support & Medical Triage Assistant.\n\n" +
      "I continuously evaluate your health telemetry and symptoms. How can I assist you with your physiological status or mission wellness today?\n\n" +
      "*(If an acute medical condition is detected, an immediate uplink to the Ground Flight Surgeon Support Team will be established.)*",
    timestamp: nowStr,
    isEscalation: false,
    escalationReason: null,
    escalationLink: null,
  };

  const stmt = db.prepare(`
    INSERT INTO support_chat_sessions (
      session_id, astronaut_id, created_at, status, chief_complaint, triage_level, escalated, escalation_link, messages, key_recommendations
    ) VALUES (?, ?, ?, 'ACTIVE', 'General In-Flight Consultation', 'ROUTINE', 0, ?, ?, '[]')
  `);

  stmt.run(sessionId, astronautId, nowStr, DUMMY_SUPPORT_LINK, JSON.stringify([welcomeMsg]));

  return {
    session_id: sessionId,
    astronaut_id: astronautId,
    created_at: nowStr,
    ended_at: null,
    status: "ACTIVE",
    chief_complaint: "General In-Flight Consultation",
    triage_level: "ROUTINE",
    escalated: false,
    escalation_reason: null,
    escalation_link: DUMMY_SUPPORT_LINK,
    summary: null,
    key_recommendations: [],
    messages: [welcomeMsg],
  };
}

export function getAllSessions(): SupportSessionRecord[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM support_chat_sessions ORDER BY created_at DESC`).all() as any[];

  return rows.map((r) => ({
    session_id: r.session_id,
    astronaut_id: r.astronaut_id,
    created_at: r.created_at,
    ended_at: r.ended_at,
    status: r.status,
    chief_complaint: r.chief_complaint,
    triage_level: r.triage_level,
    escalated: Boolean(r.escalated),
    escalation_reason: r.escalation_reason,
    escalation_link: r.escalation_link || DUMMY_SUPPORT_LINK,
    summary: r.summary,
    key_recommendations: r.key_recommendations ? JSON.parse(r.key_recommendations) : [],
    messages: r.messages ? JSON.parse(r.messages) : [],
  }));
}

export function getSessionById(sessionId: string): SupportSessionRecord | null {
  const db = getDb();
  const r = db.prepare(`SELECT * FROM support_chat_sessions WHERE session_id = ?`).get(sessionId) as any;
  if (!r) return null;

  return {
    session_id: r.session_id,
    astronaut_id: r.astronaut_id,
    created_at: r.created_at,
    ended_at: r.ended_at,
    status: r.status,
    chief_complaint: r.chief_complaint,
    triage_level: r.triage_level,
    escalated: Boolean(r.escalated),
    escalation_reason: r.escalation_reason,
    escalation_link: r.escalation_link || DUMMY_SUPPORT_LINK,
    summary: r.summary,
    key_recommendations: r.key_recommendations ? JSON.parse(r.key_recommendations) : [],
    messages: r.messages ? JSON.parse(r.messages) : [],
  };
}

export function deleteSession(sessionId: string): boolean {
  try {
    const db = getDb();
    const res = db.prepare(`DELETE FROM support_chat_sessions WHERE session_id = ?`).run(sessionId);
    return res.changes > 0;
  } catch (err) {
    console.error("Failed to delete support session:", err);
    return false;
  }
}

export async function sendChatMessage(
  sessionId: string,
  userText: string,
  astronautId = "ACB-014"
): Promise<{
  session: SupportSessionRecord;
  reply: string;
  isEscalated: boolean;
  triageLevel: "ROUTINE" | "ELEVATED" | "CRITICAL";
  escalationReason: string | null;
  escalationLink: string | null;
  timestamp: string;
  source: "kaggle_ai" | "local_protocol";
}> {
  const db = getDb();
  let session = getSessionById(sessionId);
  const nowStr = getLocalTimestamp();

  if (!session) {
    session = createNewSession(astronautId);
  }

  const userMsg: SupportMessage = {
    id: `msg-${Math.random().toString(36).substring(2, 8)}`,
    sender: "user",
    text: userText,
    timestamp: nowStr,
    isEscalation: false,
  };

  const msgs = [...session.messages, userMsg];

  // Retrieve live astronaut telemetry from medical database (astro_code_blue.db)
  const medRecord = getAstronautMedicalRecord();
  const medicalBriefing = formatMedicalContextForPrompt(medRecord);

  // Connect to Kaggle AI with conversational memory and live medical context
  const kaggleResult = await queryKaggleAIChat(userText, msgs, undefined, medicalBriefing);
  const aiResult = generateSupportAIReply(userText, msgs, kaggleResult?.reply, medRecord);

  const aiMsg: SupportMessage = {
    id: `msg-${Math.random().toString(36).substring(2, 8)}`,
    sender: "ai",
    text: aiResult.reply,
    timestamp: getLocalTimestamp(),
    isEscalation: aiResult.isEscalated,
    escalationReason: aiResult.escalationReason,
    escalationLink: aiResult.escalationLink,
  };
  msgs.push(aiMsg);

  let escalated = session.escalated || aiResult.isEscalated;
  let triageLevel = session.triage_level;
  if (aiResult.isEscalated) {
    triageLevel = "CRITICAL";
  } else if (aiResult.triageLevel === "ELEVATED" && triageLevel !== "CRITICAL") {
    triageLevel = "ELEVATED";
  }

  let chiefComplaint = session.chief_complaint;
  if (chiefComplaint === "General In-Flight Consultation") {
    chiefComplaint = userText.length > 50 ? userText.slice(0, 47) + "..." : userText;
  }

  const escalationReason = aiResult.isEscalated ? aiResult.escalationReason : session.escalation_reason;

  const updateStmt = db.prepare(`
    UPDATE support_chat_sessions
    SET messages = ?, escalated = ?, triage_level = ?, chief_complaint = ?, escalation_reason = ?
    WHERE session_id = ?
  `);
  updateStmt.run(
    JSON.stringify(msgs),
    escalated ? 1 : 0,
    triageLevel,
    chiefComplaint,
    escalationReason,
    session.session_id
  );

  const updatedSession = getSessionById(session.session_id)!;

  return {
    session: updatedSession,
    reply: aiResult.reply,
    isEscalated: aiResult.isEscalated,
    triageLevel,
    escalationReason: aiResult.escalationReason,
    escalationLink: aiResult.escalationLink,
    timestamp: aiMsg.timestamp,
    source: aiResult.source,
  };
}

export function endSessionAndSummarize(sessionId: string): {
  session: SupportSessionRecord;
  summary: ReturnType<typeof generateSessionSummary>;
} {
  const db = getDb();
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const nowStr = getLocalTimestamp();
  const summaryData = generateSessionSummary(session.messages);

  const closingMsg: SupportMessage = {
    id: `msg-${Math.random().toString(36).substring(2, 8)}`,
    sender: "system",
    text: `Session concluded and clinical summary filed to Mission Tele-Triage Database (astro_support.db) at ${nowStr}.`,
    timestamp: nowStr,
    isEscalation: false,
  };
  const msgs = [...session.messages, closingMsg];

  const updateStmt = db.prepare(`
    UPDATE support_chat_sessions
    SET status = 'ENDED', ended_at = ?, summary = ?, key_recommendations = ?,
        triage_level = ?, escalated = ?, escalation_reason = ?, messages = ?
    WHERE session_id = ?
  `);

  updateStmt.run(
    nowStr,
    summaryData.summary,
    JSON.stringify(summaryData.keyRecommendations),
    summaryData.triageLevel,
    summaryData.escalated ? 1 : 0,
    summaryData.escalationReason,
    JSON.stringify(msgs),
    sessionId
  );

  const updatedSession = getSessionById(sessionId)!;
  return {
    session: updatedSession,
    summary: summaryData,
  };
}
