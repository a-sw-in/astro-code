import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";

const MEDICAL_DB_PATH = path.join(process.cwd(), "backend", "astro_code_blue.db");

export type RegionHealthStatus = {
  status: "nominal" | "caution" | "critical" | "no-data";
  score: number; // 0–100, 100 = perfect
  label: string;
  summary: string;
  keyMetric?: string;
  aiNote?: string;
};

export type BodyHealthMap = {
  brain: RegionHealthStatus;
  eyes: RegionHealthStatus;
  heart: RegionHealthStatus;
  lungs: RegionHealthStatus;
  bones: RegionHealthStatus;
  muscles: RegionHealthStatus;
  kidneys: RegionHealthStatus;
  "inner-ear": RegionHealthStatus;
  lastUpdated: string | null;
  overallStatus: string;
  dataAvailable: boolean;
};

function statusFromScore(score: number): "nominal" | "caution" | "critical" {
  if (score >= 75) return "nominal";
  if (score >= 45) return "caution";
  return "critical";
}

export async function GET() {
  try {
    if (!fs.existsSync(MEDICAL_DB_PATH)) {
      return NextResponse.json(buildNoDataResponse(), { status: 200 });
    }

    const db = new DatabaseSync(MEDICAL_DB_PATH, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT assessmentDate, submittedAt, groups, analysis
         FROM assessments
         ORDER BY datetime(assessmentDate) DESC, datetime(submittedAt) DESC, rowid DESC
         LIMIT 10`
      )
      .all() as any[];

    if (!rows || rows.length === 0) {
      return NextResponse.json(buildNoDataResponse(), { status: 200 });
    }

    const latestRow = rows[0];
    const latestAnalysis =
      typeof latestRow.analysis === "string"
        ? JSON.parse(latestRow.analysis)
        : latestRow.analysis || {};

    // Collect the most recent value for each field across all rows
    let heartRate: number | null = null;
    let systolic: number | null = null;
    let diastolic: number | null = null;
    let spo2: number | null = null;
    let bodyTemp: number | null = null;
    let sleepTotal: number | null = null;
    let waterTotal: number | null = null;
    let exerciseTotal: number | null = null;
    let fatigueLevel: number | null = null;
    let stressLevel: number | null = null;
    let co2: number | null = null;
    const symptoms: string[] = [];
    let visualAcuityLeft: number | null = null;
    let visualAcuityRight: number | null = null;

    for (const r of rows) {
      try {
        const g =
          typeof r.groups === "string" ? JSON.parse(r.groups) : r.groups || {};
        const vs = g.vitalSigns || {};
        const sw = g.sleepAndWellness || {};
        const vis = g.visionAndSymptoms || {};
        const env = g.spaceEnvironment || {};

        if (heartRate === null && vs.heartRate?.value != null) heartRate = Number(vs.heartRate.value);
        if (systolic === null && vs.systolic?.value != null) systolic = Number(vs.systolic.value);
        if (diastolic === null && vs.diastolic?.value != null) diastolic = Number(vs.diastolic.value);
        if (spo2 === null && vs.oxygenSaturation?.value != null) spo2 = Number(vs.oxygenSaturation.value);
        if (bodyTemp === null && vs.bodyTemperature?.value != null) bodyTemp = Number(vs.bodyTemperature.value);
        if (fatigueLevel === null && sw.fatigueLevel?.value != null) fatigueLevel = Number(sw.fatigueLevel.value);
        if (stressLevel === null && sw.stressLevel?.value != null) stressLevel = Number(sw.stressLevel.value);
        if (co2 === null && env.co2Concentration?.value != null) co2 = Number(env.co2Concentration.value);
        if (visualAcuityLeft === null && vis.measurements?.visualAcuityLeft?.value != null)
          visualAcuityLeft = Number(vis.measurements.visualAcuityLeft.value);
        if (visualAcuityRight === null && vis.measurements?.visualAcuityRight?.value != null)
          visualAcuityRight = Number(vis.measurements.visualAcuityRight.value);

        if (Array.isArray(vis.symptoms) && symptoms.length === 0) {
          for (const s of vis.symptoms) {
            if (typeof s === "string") symptoms.push(s);
            else if (s && typeof s === "object") symptoms.push(s.symptom || "Symptom");
          }
        }
      } catch {}
    }

    // Pull cumulative daily aggregates from latest analysis
    const da = latestAnalysis.daily_aggregates || {};
    if (sleepTotal === null && da.total_sleep != null) sleepTotal = Number(da.total_sleep);
    if (waterTotal === null && da.total_water != null) waterTotal = Number(da.total_water);
    if (exerciseTotal === null && da.total_exercise != null) exerciseTotal = Number(da.total_exercise);

    // Also look in sleepAndWellness of latest row
    try {
      const g0 = typeof rows[0].groups === "string" ? JSON.parse(rows[0].groups) : rows[0].groups || {};
      const sw0 = g0.sleepAndWellness || {};
      if (sleepTotal === null && sw0.sleepDuration?.value != null) sleepTotal = Number(sw0.sleepDuration.value);
      if (waterTotal === null && sw0.waterIntake?.value != null) waterTotal = Number(sw0.waterIntake.value);
      if (exerciseTotal === null && sw0.exerciseDuration?.value != null) exerciseTotal = Number(sw0.exerciseDuration.value);
    } catch {}

    const overallStatus = latestAnalysis.overall_health_status || "Nominal";
    const lastUpdated = String(latestRow.assessmentDate || latestRow.submittedAt || "");

    // ─── Per-region scoring ────────────────────────────────────────────────────

    // BRAIN — cognition: driven by sleep, fatigue, stress, CO2
    const brainScore = scoreBrain(sleepTotal, fatigueLevel, stressLevel, co2, symptoms);

    // EYES — SANS: driven by visual acuity, symptoms mentioning vision/eye
    const eyesScore = scoreEyes(visualAcuityLeft, visualAcuityRight, symptoms);

    // HEART — cardiovascular: driven by HR, BP, SpO2, exercise
    const heartScore = scoreHeart(heartRate, systolic, diastolic, spo2, exerciseTotal);

    // LUNGS — respiratory: driven by SpO2, CO2
    const lungsScore = scoreLungs(spo2, co2);

    // BONES — skeletal: driven by exercise (resistance), mission duration proxy
    const bonesScore = scoreBones(exerciseTotal);

    // MUSCLES — musculoskeletal: driven by exercise duration, fatigue
    const musclesScore = scoreMuscles(exerciseTotal, fatigueLevel);

    // KIDNEYS — fluid balance: driven by water intake, hydration
    const kidneysScore = scoreKidneys(waterTotal);

    // INNER EAR — vestibular: driven by symptoms (nausea, dizziness), stress
    const innerEarScore = scoreInnerEar(symptoms, stressLevel);

    const bodyMap: BodyHealthMap = {
      brain: brainScore,
      eyes: eyesScore,
      heart: heartScore,
      lungs: lungsScore,
      bones: bonesScore,
      muscles: musclesScore,
      kidneys: kidneysScore,
      "inner-ear": innerEarScore,
      lastUpdated,
      overallStatus,
      dataAvailable: true,
    };

    return NextResponse.json(bodyMap, { status: 200 });
  } catch (err) {
    console.error("[Explorer Health API] Error:", err);
    return NextResponse.json(buildNoDataResponse(), { status: 200 });
  }
}

// ─── Scoring functions ─────────────────────────────────────────────────────────

function scoreBrain(
  sleep: number | null,
  fatigue: number | null,
  stress: number | null,
  co2: number | null,
  symptoms: string[]
): RegionHealthStatus {
  if (sleep === null && fatigue === null && stress === null && co2 === null) {
    return noDataRegion("Neurological");
  }
  let score = 100;
  const notes: string[] = [];

  if (sleep !== null) {
    if (sleep < 5) { score -= 35; notes.push(`Only ${sleep}h sleep — severe cognitive impairment risk`); }
    else if (sleep < 7) { score -= 18; notes.push(`${sleep}h sleep — below the 7.5h mission target`); }
    else notes.push(`${sleep}h sleep — cognitive restoration adequate`);
  }
  if (fatigue !== null) {
    if (fatigue >= 4) { score -= 20; notes.push(`High fatigue (${fatigue}/5)`); }
    else if (fatigue >= 3) { score -= 10; notes.push(`Moderate fatigue (${fatigue}/5)`); }
  }
  if (stress !== null) {
    if (stress >= 4) { score -= 15; notes.push(`High stress (${stress}/5)`); }
    else if (stress >= 3) { score -= 8; notes.push(`Moderate stress (${stress}/5)`); }
  }
  if (co2 !== null && co2 > 3) { score -= 20; notes.push(`CO₂ at ${co2}% — contributes to cognitive fog`); }

  const visionSym = symptoms.some((s) => /(headache|cognitive|confusion|memory)/i.test(s));
  if (visionSym) { score -= 15; notes.push("Cognitive/neurological symptoms logged"); }

  score = Math.max(0, score);
  const status = statusFromScore(score);
  return {
    status,
    score,
    label: "Neurological",
    summary: notes.length > 0 ? notes[0] : "Cognitive function within nominal parameters",
    keyMetric: sleep !== null ? `Sleep: ${sleep}h` : undefined,
    aiNote: notes.join(" · ") || "No significant neurological indicators flagged",
  };
}

function scoreEyes(
  left: number | null,
  right: number | null,
  symptoms: string[]
): RegionHealthStatus {
  const hasSANSSymptom = symptoms.some((s) =>
    /(vision|blur|eye|optic|acuity|sans|distort|swelling)/i.test(s)
  );

  if (left === null && right === null && !hasSANSSymptom) {
    return noDataRegion("SANS / Vision");
  }

  let score = 100;
  const notes: string[] = [];

  if (left !== null && right !== null) {
    const avg = (left + right) / 2;
    if (avg < 0.6) { score -= 40; notes.push(`Visual acuity L:${left} R:${right} — significant SANS decline`); }
    else if (avg < 0.8) { score -= 20; notes.push(`Visual acuity L:${left} R:${right} — monitor closely for SANS`); }
    else notes.push(`Visual acuity L:${left} R:${right} — within baseline`);
  }

  if (hasSANSSymptom) { score -= 30; notes.push("SANS-related symptoms logged"); }

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "SANS / Vision",
    summary: notes[0] || "No SANS indicators detected",
    keyMetric: left !== null && right !== null ? `Acuity L:${left} R:${right}` : undefined,
    aiNote: notes.join(" · ") || "Visual health nominal — continue Amsler grid monitoring",
  };
}

function scoreHeart(
  hr: number | null,
  sys: number | null,
  dia: number | null,
  spo2: number | null,
  exercise: number | null
): RegionHealthStatus {
  if (hr === null && sys === null && spo2 === null) {
    return noDataRegion("Cardiovascular");
  }

  let score = 100;
  const notes: string[] = [];

  if (hr !== null) {
    if (hr > 120 || hr < 40) { score -= 40; notes.push(`Heart rate critically abnormal: ${hr} BPM`); }
    else if (hr > 100 || hr < 50) { score -= 20; notes.push(`Heart rate outside nominal: ${hr} BPM`); }
    else notes.push(`Heart rate nominal: ${hr} BPM`);
  }

  if (sys !== null && dia !== null) {
    if (sys > 180 || dia > 120 || sys < 70) { score -= 35; notes.push(`BP critically abnormal: ${sys}/${dia} mmHg`); }
    else if (sys > 140 || dia > 90) { score -= 18; notes.push(`BP elevated: ${sys}/${dia} mmHg`); }
    else notes.push(`BP nominal: ${sys}/${dia} mmHg`);
  }

  if (spo2 !== null) {
    if (spo2 < 90) { score -= 40; notes.push(`SpO₂ critically low: ${spo2}%`); }
    else if (spo2 < 94) { score -= 20; notes.push(`SpO₂ below optimal: ${spo2}%`); }
    else notes.push(`SpO₂ nominal: ${spo2}%`);
  }

  if (exercise !== null && exercise < 20) { score -= 10; notes.push("Low exercise — cardiovascular deconditioning risk"); }

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "Cardiovascular",
    summary: notes[0] || "Cardiovascular readings within flight parameters",
    keyMetric: hr !== null ? `HR: ${hr} BPM` : sys !== null ? `BP: ${sys}/${dia} mmHg` : undefined,
    aiNote: notes.join(" · ") || "No cardiovascular alerts",
  };
}

function scoreLungs(spo2: number | null, co2: number | null): RegionHealthStatus {
  if (spo2 === null && co2 === null) return noDataRegion("Respiratory");

  let score = 100;
  const notes: string[] = [];

  if (spo2 !== null) {
    if (spo2 < 90) { score -= 45; notes.push(`SpO₂ critically low: ${spo2}%`); }
    else if (spo2 < 94) { score -= 22; notes.push(`SpO₂ below optimal: ${spo2}%`); }
    else notes.push(`SpO₂ nominal: ${spo2}%`);
  }

  if (co2 !== null) {
    if (co2 > 5) { score -= 35; notes.push(`CO₂ critically high: ${co2}% — cabin scrubber alert`); }
    else if (co2 > 3) { score -= 18; notes.push(`CO₂ elevated: ${co2}% — monitor scrubbers`); }
    else notes.push(`CO₂ normal: ${co2}%`);
  }

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "Respiratory",
    summary: notes[0] || "Respiratory system nominal",
    keyMetric: spo2 !== null ? `SpO₂: ${spo2}%` : co2 !== null ? `CO₂: ${co2}%` : undefined,
    aiNote: notes.join(" · ") || "Gas exchange and cabin atmosphere nominal",
  };
}

function scoreBones(exercise: number | null): RegionHealthStatus {
  if (exercise === null) return noDataRegion("Skeletal / Bone Density");

  let score = 100;
  const notes: string[] = [];

  // Bone health primarily depends on resistance exercise in microgravity
  if (exercise === 0) { score -= 40; notes.push("No exercise logged — bone mineral loss risk (1–1.5%/month without ARED)"); }
  else if (exercise < 20) { score -= 25; notes.push(`Only ${exercise} mins exercise — inadequate axial bone loading`); }
  else if (exercise < 40) { score -= 12; notes.push(`${exercise} mins exercise — approaching target, increase resistance load`); }
  else notes.push(`${exercise} mins exercise — bone loading quota met`);

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "Skeletal / Bone Density",
    summary: notes[0] || "Bone loading protocol on track",
    keyMetric: exercise !== null ? `Exercise: ${exercise} mins` : undefined,
    aiNote: notes.join(" · ") || "ARED resistance protocol maintaining skeletal integrity",
  };
}

function scoreMuscles(exercise: number | null, fatigue: number | null): RegionHealthStatus {
  if (exercise === null && fatigue === null) return noDataRegion("Musculoskeletal");

  let score = 100;
  const notes: string[] = [];

  if (exercise !== null) {
    if (exercise === 0) { score -= 35; notes.push("No exercise logged — muscle atrophy risk in microgravity"); }
    else if (exercise < 25) { score -= 20; notes.push(`Only ${exercise} mins — below recommended 45 min countermeasure`); }
    else notes.push(`${exercise} mins exercise — musculoskeletal maintenance adequate`);
  }

  if (fatigue !== null) {
    if (fatigue >= 4) { score -= 20; notes.push(`High fatigue (${fatigue}/5) — risk of overuse or underrecovery`); }
    else if (fatigue >= 3) { score -= 10; notes.push(`Moderate fatigue (${fatigue}/5)`); }
  }

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "Musculoskeletal",
    summary: notes[0] || "Muscle performance within acceptable parameters",
    keyMetric: exercise !== null ? `Exercise: ${exercise} mins` : undefined,
    aiNote: notes.join(" · ") || "Musculoskeletal system nominal — maintain ARED + T2 schedule",
  };
}

function scoreKidneys(water: number | null): RegionHealthStatus {
  if (water === null) return noDataRegion("Fluid Balance / Renal");

  let score = 100;
  const notes: string[] = [];

  if (water < 1.0) { score -= 45; notes.push(`Severe dehydration risk: only ${water}L (minimum 2.5L target)`); }
  else if (water < 2.0) { score -= 25; notes.push(`Hydration low: ${water}L — kidney stone risk elevated`); }
  else if (water < 2.5) { score -= 10; notes.push(`Hydration: ${water}L — close to 2.5L target`); }
  else notes.push(`Hydration: ${water}L — fluid balance adequate`);

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "Fluid Balance / Renal",
    summary: notes[0] || "Renal and fluid balance nominal",
    keyMetric: water !== null ? `Water: ${water}L` : undefined,
    aiNote: notes.join(" · ") || "Adequate hydration — kidney stone risk within mission norms",
  };
}

function scoreInnerEar(symptoms: string[], stress: number | null): RegionHealthStatus {
  const vestibularSym = symptoms.some((s) =>
    /(nausea|vomit|dizziness|vertigo|motion|balance|sas|lightheaded|faint)/i.test(s)
  );

  if (!vestibularSym && stress === null) return noDataRegion("Vestibular / Balance");

  let score = 100;
  const notes: string[] = [];

  if (vestibularSym) { score -= 35; notes.push("Vestibular symptoms logged (nausea/dizziness/SAS)"); }
  if (stress !== null && stress >= 4) { score -= 15; notes.push(`High stress (${stress}/5) — amplifies neuro-vestibular disruption`); }

  score = Math.max(0, score);
  return {
    status: statusFromScore(score),
    score,
    label: "Vestibular / Balance",
    summary: notes[0] || "No vestibular symptoms reported",
    keyMetric: vestibularSym ? "SAS symptoms active" : undefined,
    aiNote: notes.join(" · ") || "Sensorimotor adaptation proceeding normally",
  };
}

function noDataRegion(label: string): RegionHealthStatus {
  return {
    status: "no-data",
    score: 0,
    label,
    summary: "No data logged for this system yet",
    aiNote: "Log an assessment to generate AI health status for this region",
  };
}

function buildNoDataResponse(): BodyHealthMap {
  const nd = (label: string): RegionHealthStatus => noDataRegion(label);
  return {
    brain: nd("Neurological"),
    eyes: nd("SANS / Vision"),
    heart: nd("Cardiovascular"),
    lungs: nd("Respiratory"),
    bones: nd("Skeletal / Bone Density"),
    muscles: nd("Musculoskeletal"),
    kidneys: nd("Fluid Balance / Renal"),
    "inner-ear": nd("Vestibular / Balance"),
    lastUpdated: null,
    overallStatus: "No Data",
    dataAvailable: false,
  };
}
