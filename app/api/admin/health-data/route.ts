import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";

export async function GET() {
  try {
    const dbPath = path.join(process.cwd(), "backend", "astro_code_blue.db");
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ assessments: [], totalCount: 0, message: "No health database found" });
    }

    const db = new DatabaseSync(dbPath, { readOnly: true });

    const rows = db.prepare(`
      SELECT assessmentDate, submittedAt, groups, analysis, rowid
      FROM assessments
      ORDER BY datetime(assessmentDate) DESC, datetime(submittedAt) DESC
      LIMIT 50
    `).all() as any[];

    const assessments = rows.map((r: any) => {
      let groups: any = {};
      let analysis: any = {};
      try { groups = typeof r.groups === "string" ? JSON.parse(r.groups) : r.groups || {}; } catch {}
      try { analysis = typeof r.analysis === "string" ? JSON.parse(r.analysis) : r.analysis || {}; } catch {}

      const vs = groups.vitalSigns || {};
      const sw = groups.sleepAndWellness || {};
      const env = groups.spaceEnvironment || {};
      const vis = groups.visionAndSymptoms || {};

      return {
        id: r.rowid,
        date: r.assessmentDate,
        submittedAt: r.submittedAt,
        vitals: {
          heartRate: vs.heartRate?.value ? `${vs.heartRate.value} BPM` : null,
          bloodPressure: vs.systolic?.value && vs.diastolic?.value ? `${vs.systolic.value}/${vs.diastolic.value} mmHg` : null,
          oxygenSaturation: vs.oxygenSaturation?.value ? `${vs.oxygenSaturation.value}%` : null,
          bodyTemperature: vs.bodyTemperature?.value ? `${vs.bodyTemperature.value}°C` : null,
        },
        wellness: {
          sleep: sw.sleepDuration?.value ? `${sw.sleepDuration.value} hrs` : null,
          water: sw.waterIntake?.value ? `${sw.waterIntake.value} L` : null,
          exercise: sw.exerciseDuration?.value ? `${sw.exerciseDuration.value} mins` : null,
          fatigue: sw.fatigueLevel?.value ? `${sw.fatigueLevel.value}/5` : null,
          stress: sw.stressLevel?.value ? `${sw.stressLevel.value}/5` : null,
        },
        environment: {
          co2: env.co2Concentration?.value ? `${env.co2Concentration.value}%` : null,
          pressure: env.cabinPressure?.value ? `${env.cabinPressure.value} mmHg` : null,
          temp: env.ambientTemperature?.value ? `${env.ambientTemperature.value}°C` : null,
          radiation: env.radiationDose?.value ? `${env.radiationDose.value} mGy/d` : null,
        },
        symptoms: Array.isArray(vis.symptoms)
          ? vis.symptoms.map((s: any) => typeof s === "string" ? s : `${s.symptom} (${s.severity})`)
          : [],
        overallStatus: analysis.overall_health_status || "Unknown",
        overallSummary: analysis.overall_summary || "",
        medicalAlert: analysis.medical_alert?.advice || null,
        exercises: Array.isArray(analysis.exercises) ? analysis.exercises.length : 0,
        suggestions: Array.isArray(analysis.healthcare_suggestions) ? analysis.healthcare_suggestions : [],
      };
    });

    const latestStatus = assessments[0]?.overallStatus || "No Data";
    const criticalCount = assessments.filter((a: any) => a.overallStatus?.toLowerCase() === "critical").length;
    const cautionCount = assessments.filter((a: any) => ["caution", "elevated", "warning"].includes(a.overallStatus?.toLowerCase())).length;

    return NextResponse.json({
      assessments,
      totalCount: assessments.length,
      latestStatus,
      criticalCount,
      cautionCount,
      astronautId: "ACB-014",
    });
  } catch (err: any) {
    console.error("Admin health data error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
