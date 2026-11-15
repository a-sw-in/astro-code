"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { BACKEND_URL } from "@/app/lib/config";
import {
  ASSESSMENT_MEASUREMENT_LABELS,
  ASSESSMENT_STORAGE_KEY,
  ASSESSMENT_STORAGE_VERSION,
  parseStoredAssessments,
  type AssessmentGroups,
  type AssessmentMeasurement,
  type MeasurementSource,
  type StructuredAssessmentRecord,
  type SymptomReport,
} from "../data/health-assessments";

type FieldKind = "number" | "text" | "textarea" | "time" | "select";
type FieldConfig = {
  id: string;
  label: string;
  unit: string;
  kind: FieldKind;
  customUnit?: boolean;
  options?: string[];
  unitOptions?: string[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};
type DraftMeasurement = {
  value: string;
  unit: string;
  recordedAt: string;
  source: MeasurementSource;
  notes: string;
};
type DraftGroups = {
  sleepAndWellness: Record<string, DraftMeasurement>;
  cognitiveHealth: Record<string, DraftMeasurement>;
  visionAndSymptoms: {
    measurements: Record<string, DraftMeasurement>;
    symptoms: Record<string, { selected: boolean; severity: SymptomReport["severity"]; notes: string }>;
  };
  vitalSigns: Record<string, DraftMeasurement>;
  spaceEnvironment: Record<string, DraftMeasurement>;
  specializedMedical: Record<string, DraftMeasurement>;
};
type AssessmentDraft = {
  assessmentDate: string;
  groups: DraftGroups;
  assessmentNotes: string;
};
type MeasurementGroup = Exclude<keyof DraftGroups, "visionAndSymptoms">;
type ImportGroup = "cognitiveHealth" | "spaceEnvironment";
type MeasurementRow = {
  group: string;
  label: string;
  value: string;
  unit: string;
  recordedAt: string;
  source: string;
};

const sourceOptions: { value: MeasurementSource; label: string }[] = [
  { value: "manual_entry", label: "Manual entry" },
  { value: "self_reported", label: "Self-reported" },
  { value: "device", label: "Device" },
  { value: "medical_test", label: "Medical test" },
  { value: "imported", label: "Imported record" },
];

const sectionFields = {
  sleepAndWellness: [
    { id: "sleepDuration", label: "Sleep this session", unit: "hours", kind: "number", min: 0, step: 0.1 },
    { id: "sleepQuality", label: "Sleep quality", unit: "1–5", kind: "number", min: 1, max: 5, step: 1 },
    { id: "sleepDisturbances", label: "Sleep disturbances", unit: "self-report", kind: "select", options: ["Yes", "No"] },
    { id: "bedtime", label: "Sleep schedule / bedtime", unit: "local time", kind: "time" },
    {
      id: "exerciseDuration",
      label: "Exercise this session",
      unit: "minutes",
      kind: "number",
      min: 0,
      step: 1,
      hint: "Only enter a value if you had exercise in the moment after your previous submission. Otherwise leave blank."
    },
    {
      id: "exerciseType",
      label: "Exercise type",
      unit: "activity",
      kind: "select",
      options: ["Aerobic", "Resistance", "Other"],
      hint: "Select exercise type only if you completed an exercise session after your previous submission."
    },
    { id: "waterIntake", label: "Hydration this session", unit: "L", kind: "number", min: 0, step: 0.1 },
    { id: "fatigueLevel", label: "Fatigue level", unit: "1–5", kind: "number", min: 1, max: 5, step: 1 },
  ],
  cognitiveHealth: [
    { id: "moodRating", label: "Mood rating", unit: "1–5", kind: "number", min: 1, max: 5, step: 1 },
    { id: "stressLevel", label: "Stress level", unit: "1–5", kind: "number", min: 1, max: 5, step: 1 },
    { id: "concentrationDifficulty", label: "Concentration difficulty", unit: "self-report", kind: "select", options: ["Yes", "No"] },
    { id: "emotionalDistress", label: "Feeling isolated or emotionally distressed", unit: "self-report", kind: "select", options: ["Yes", "No"] },
    { id: "reactionTime", label: "Reaction time", unit: "as reported", customUnit: true, kind: "number", min: 0, step: 0.01, hint: "Enter the original result and units reported by the assessment." },
    { id: "attention", label: "Attention", unit: "as reported", customUnit: true, kind: "number", min: 0, step: 0.01 },
    { id: "visualWorkingMemory", label: "Visual working memory", unit: "as reported", customUnit: true, kind: "number", min: 0, step: 0.01 },
    { id: "verbalWorkingMemory", label: "Verbal working memory", unit: "as reported", customUnit: true, kind: "number", min: 0, step: 0.01 },
  ],
  visionAndSymptoms: [
    { id: "blurredVision", label: "Blurred vision", unit: "self-report", kind: "select", options: ["Yes", "No"] },
    { id: "distortedVision", label: "Distorted vision", unit: "self-report", kind: "select", options: ["Yes", "No"] },
    { id: "nearVisionChanges", label: "Near vision changes", unit: "self-report", kind: "select", options: ["Yes", "No"] },
    { id: "visualAcuity", label: "Visual acuity result", unit: "as recorded", kind: "text" },
    { id: "amslerGrid", label: "Amsler grid result", unit: "as recorded", kind: "text" },
  ],
  vitalSigns: [
    { id: "heartRate", label: "Heart rate", unit: "BPM", kind: "number", min: 0, step: 1 },
    { id: "systolic", label: "Systolic blood pressure", unit: "mmHg", kind: "number", min: 0, step: 1 },
    { id: "diastolic", label: "Diastolic blood pressure", unit: "mmHg", kind: "number", min: 0, step: 1 },
    { id: "oxygenSaturation", label: "Oxygen saturation", unit: "%", kind: "number", min: 0, step: 0.1 },
    { id: "bodyTemperature", label: "Body temperature", unit: "°C", kind: "number", min: 0, step: 0.1 },
    { id: "respiratoryRate", label: "Respiratory rate", unit: "breaths/min", kind: "number", min: 0, step: 1 },
    { id: "muscleFatigue", label: "Muscle fatigue", unit: "self-report", kind: "textarea" },
    {
      id: "exercisePerformance",
      label: "Exercise performance",
      unit: "self-report",
      kind: "textarea",
      hint: "Only report performance notes if you had an exercise session in the moment after your previous submission."
    },
  ],
  spaceEnvironment: [
    { id: "cabinCo2", label: "Cabin CO₂ concentration", unit: "mmHg", kind: "number", min: 0, step: 0.01 },
    { id: "radiationExposure", label: "Radiation exposure", unit: "mSv", kind: "number", min: 0, step: 0.001 },
    { id: "radiationDoseRate", label: "Radiation dose rate", unit: "mSv/day", kind: "number", min: 0, step: 0.001 },
    { id: "cabinTemperature", label: "Cabin temperature", unit: "°C", kind: "number", step: 0.1 },
    { id: "cabinPressure", label: "Cabin pressure", unit: "kPa", kind: "number", min: 0, step: 0.01, unitOptions: ["kPa", "mmHg", "psi"] },
    { id: "humidity", label: "Humidity", unit: "%", kind: "number", min: 0, step: 0.1 },
  ],
  specializedMedical: [
    { id: "boneMineralDensity", label: "Bone mineral density (DXA)", unit: "result as reported", customUnit: true, kind: "textarea" },
    { id: "boneHealthMarkers", label: "Bone health markers (blood / urine)", unit: "results as reported", customUnit: true, kind: "textarea" },
    { id: "vitaminD", label: "Vitamin D level", unit: "ng/mL", kind: "number", min: 0, step: 0.1 },
    { id: "octEyeExam", label: "OCT / eye examination results", unit: "results as reported", customUnit: true, kind: "textarea" },
    { id: "neckVeinUltrasound", label: "Neck vein ultrasound results", unit: "results as reported", customUnit: true, kind: "textarea" },
    { id: "immuneMarkers", label: "Immune markers / laboratory results", unit: "results as reported", customUnit: true, kind: "textarea" },
  ],
} satisfies Record<string, FieldConfig[]>;

const sectionMeta = [
  {
    id: "sleepAndWellness",
    number: "01",
    title: "Sleep & daily wellness",
    description: "Self-reported sleep, activity, hydration and fatigue.",
  },
  {
    id: "cognitiveHealth",
    number: "02",
    title: "Mental & cognitive health",
    description: "Record how you feel and enter results only from a completed assessment.",
  },
  {
    id: "visionAndSymptoms",
    number: "03",
    title: "Vision & symptoms",
    description: "Separate vision observations from self-reported symptoms.",
  },
  {
    id: "vitalSigns",
    number: "04",
    title: "Vital signs & physical health",
    description: "Optional readings from available monitoring devices.",
  },
  {
    id: "spaceEnvironment",
    number: "05",
    title: "Space environment",
    description: "Use recorded spacecraft sensor or radiation-monitor data when available.",
  },
  {
    id: "specializedMedical",
    number: "06",
    title: "Specialized medical measurements",
    description: "Optional results from appropriate equipment and professional assessment.",
  },
] as const;

const symptomNames = [
  "Headache",
  "Dizziness",
  "Lightheadedness",
  "Nausea",
  "Fainting",
  "Muscle pain",
  "Sleep difficulty",
  "Other symptoms",
] as const;

const numericMeasurementIds = new Set([
  "sleepDuration", "sleepQuality", "exerciseDuration", "waterIntake", "fatigueLevel",
  "moodRating", "stressLevel", "reactionTime", "attention", "visualWorkingMemory",
  "verbalWorkingMemory", "heartRate", "systolic", "diastolic", "oxygenSaturation",
  "bodyTemperature", "respiratoryRate", "cabinCo2", "radiationExposure",
  "radiationDoseRate", "cabinTemperature", "cabinPressure", "humidity", "vitaminD",
]);
const medicalResultIds = new Set([
  "reactionTime", "attention", "visualWorkingMemory", "verbalWorkingMemory",
  "boneMineralDensity", "boneHealthMarkers", "vitaminD", "octEyeExam",
  "neckVeinUltrasound", "immuneMarkers",
]);
const selfReportedIds = new Set([
  "sleepDuration", "sleepQuality", "sleepDisturbances", "bedtime",
  "exerciseDuration", "exerciseType", "waterIntake", "fatigueLevel",
  "moodRating", "stressLevel", "concentrationDifficulty", "emotionalDistress",
  "blurredVision", "distortedVision", "nearVisionChanges", "muscleFatigue",
  "exercisePerformance",
]);

const groupTitles: Record<keyof AssessmentGroups, string> = {
  sleepAndWellness: "Sleep & daily wellness",
  cognitiveHealth: "Mental & cognitive health",
  visionAndSymptoms: "Vision & symptoms",
  vitalSigns: "Vital signs & physical health",
  spaceEnvironment: "Space environment",
  specializedMedical: "Specialized medical measurements",
};

function localDateTimeValue(date?: Date | string | null): string {
  if (!date && typeof window === "undefined") {
    return "";
  }
  const d = date ? (typeof date === "string" || typeof date === "number" ? new Date(date) : date) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : (typeof window !== "undefined" ? new Date() : null);
  if (!valid) return "";
  const year = valid.getFullYear();
  const month = String(valid.getMonth() + 1).padStart(2, "0");
  const day = String(valid.getDate()).padStart(2, "0");
  const hours = String(valid.getHours()).padStart(2, "0");
  const minutes = String(valid.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function emptyMeasurement(field: FieldConfig, recordedAt: string = ""): DraftMeasurement {
  const source: MeasurementSource = medicalResultIds.has(field.id)
    ? "medical_test"
    : selfReportedIds.has(field.id)
      ? "self_reported"
      : "manual_entry";
  return {
    value: "",
    unit: field.unit,
    recordedAt,
    source,
    notes: "",
  };
}

function createEmptyDraft(recordedAt?: string): AssessmentDraft {
  const now = recordedAt && recordedAt.trim() ? recordedAt : (typeof window !== "undefined" ? localDateTimeValue() : "");
  const makeGroup = (fields: readonly FieldConfig[]) =>
    Object.fromEntries(fields.map((field) => [field.id, emptyMeasurement(field, now)]));
  return {
    assessmentDate: now,
    groups: {
      sleepAndWellness: makeGroup(sectionFields.sleepAndWellness),
      cognitiveHealth: makeGroup(sectionFields.cognitiveHealth),
      visionAndSymptoms: {
        measurements: makeGroup(sectionFields.visionAndSymptoms),
        symptoms: Object.fromEntries(
          symptomNames.map((symptom) => [
            symptom,
            { selected: false, severity: "unspecified" as const, notes: "" },
          ]),
        ),
      },
      vitalSigns: makeGroup(sectionFields.vitalSigns),
      spaceEnvironment: makeGroup(sectionFields.spaceEnvironment),
      specializedMedical: makeGroup(sectionFields.specializedMedical),
    },
    assessmentNotes: "",
  };
}

function validateField(field: FieldConfig, value: string) {
  if (!value.trim() || field.kind !== "number") return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Enter a valid number.";
  if (field.min !== undefined && parsed < field.min) return `Enter a value of at least ${field.min}.`;
  if (field.max !== undefined && parsed > field.max) return `Enter a value no greater than ${field.max}.`;
  if (field.step === 1 && !Number.isInteger(parsed)) return "Enter a whole number.";
  return "";
}

function sourceLabel(source: MeasurementSource) {
  return sourceOptions.find((option) => option.value === source)?.label ?? "Recorded";
}

function measurementRows(record: StructuredAssessmentRecord): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  for (const [group, values] of Object.entries(record.groups)) {
    const measurements =
      group === "visionAndSymptoms"
        ? record.groups.visionAndSymptoms.measurements
        : values as Record<string, AssessmentMeasurement>;
    for (const [key, measurement] of Object.entries(measurements)) {
      rows.push({
        group: groupTitles[group as keyof AssessmentGroups],
        label: ASSESSMENT_MEASUREMENT_LABELS[key] ?? key,
        value: String(measurement.value),
        unit: measurement.unit,
        recordedAt: measurement.recordedAt,
        source: sourceLabel(measurement.source),
      });
    }
  }
  return rows;
}

function countRecordedValues(record: StructuredAssessmentRecord) {
  return measurementRows(record).length + record.groups.visionAndSymptoms.symptoms.length;
}

function formatRecordedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toStoredMeasurement(
  draft: DraftMeasurement,
  fieldId: string,
  fallbackDate: string,
): AssessmentMeasurement | undefined {
  if (!draft.value.trim()) return undefined;
  const value = numericMeasurementIds.has(fieldId) ? Number(draft.value) : draft.value.trim();
  const dateVal = draft.recordedAt && draft.recordedAt.trim() ? draft.recordedAt.trim() : fallbackDate;
  const normalizedRecordedAt = dateVal.length === 16 ? `${dateVal}:00` : dateVal;
  return {
    value,
    unit: draft.unit.trim(),
    recordedAt: normalizedRecordedAt,
    source: draft.source,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };
}

function toStoredGroup(fields: Record<string, DraftMeasurement>, fallbackDate: string) {
  const measurements: Record<string, AssessmentMeasurement> = {};
  for (const [fieldId, draft] of Object.entries(fields)) {
    const measurement = toStoredMeasurement(draft, fieldId, fallbackDate);
    if (measurement) measurements[fieldId] = measurement;
  }
  return measurements;
}

function makeStoredRecord(
  draft: AssessmentDraft,
  existingId?: string,
): StructuredAssessmentRecord {
  const baseDate = draft.assessmentDate.trim();
  const assessmentDateStr = baseDate.length === 16 ? `${baseDate}:00` : baseDate;
  const submittedAt = `${localDateTimeValue()}:00`;
  const selectedSymptoms: SymptomReport[] = symptomNames.flatMap((symptom) => {
    const entry = draft.groups.visionAndSymptoms.symptoms[symptom];
    if (!entry.selected) return [];
    const label =
      symptom === "Other symptoms"
        ? entry.notes.trim().split("\n", 1)[0] || "Other symptoms"
        : symptom;
    return [{
      symptom: label,
      severity: entry.severity,
      recordedAt: assessmentDateStr,
      source: "self_reported",
      ...(entry.notes.trim() ? { notes: entry.notes.trim() } : {}),
    }];
  });
  return {
    schemaVersion: ASSESSMENT_STORAGE_VERSION,
    id: existingId || crypto.randomUUID(),
    assessmentDate: assessmentDateStr,
    submittedAt,
    groups: {
      sleepAndWellness: toStoredGroup(draft.groups.sleepAndWellness, assessmentDateStr),
      cognitiveHealth: toStoredGroup(draft.groups.cognitiveHealth, assessmentDateStr),
      visionAndSymptoms: {
        measurements: toStoredGroup(draft.groups.visionAndSymptoms.measurements, assessmentDateStr),
        symptoms: selectedSymptoms,
      },
      vitalSigns: toStoredGroup(draft.groups.vitalSigns, assessmentDateStr),
      spaceEnvironment: toStoredGroup(draft.groups.spaceEnvironment, assessmentDateStr),
      specializedMedical: toStoredGroup(draft.groups.specializedMedical, assessmentDateStr),
    },
    ...(draft.assessmentNotes.trim()
      ? { assessmentNotes: draft.assessmentNotes.trim() }
      : {}),
  };
}

function recordToDraft(record: StructuredAssessmentRecord): AssessmentDraft {
  const empty = createEmptyDraft(record.assessmentDate);
  const groups = record.groups;

  function fillGroup(
    targetGroup: Record<string, DraftMeasurement>,
    sourceGroup: Record<string, AssessmentMeasurement> | undefined,
  ) {
    if (!sourceGroup) return targetGroup;
    const filled: Record<string, DraftMeasurement> = { ...targetGroup };
    for (const [key, meas] of Object.entries(sourceGroup)) {
      if (filled[key]) {
        const isCumulativeSession = key === "sleepDuration" || key === "waterIntake" || key === "exerciseDuration";
        filled[key] = {
          value: isCumulativeSession ? "" : (meas.value !== undefined && meas.value !== null ? String(meas.value) : ""),
          unit: meas.unit || filled[key].unit,
          recordedAt: localDateTimeValue(),
          source: meas.source || "manual_entry",
          notes: isCumulativeSession ? "" : (meas.notes || ""),
        };
      }
    }
    return filled;
  }

  const visionMeasurements = fillGroup(
    empty.groups.visionAndSymptoms.measurements,
    groups.visionAndSymptoms?.measurements,
  );

  const symptomState = { ...empty.groups.visionAndSymptoms.symptoms };
  if (Array.isArray(groups.visionAndSymptoms?.symptoms)) {
    for (const s of groups.visionAndSymptoms.symptoms) {
      if (symptomState[s.symptom]) {
        symptomState[s.symptom] = {
          selected: true,
          severity: s.severity || "mild",
          notes: s.notes || "",
        };
      } else {
        symptomState["Other symptoms"] = {
          selected: true,
          severity: s.severity || "mild",
          notes: s.symptom + (s.notes ? ` - ${s.notes}` : ""),
        };
      }
    }
  }

  return {
    assessmentDate: localDateTimeValue(),
    groups: {
      sleepAndWellness: fillGroup(empty.groups.sleepAndWellness, groups.sleepAndWellness),
      cognitiveHealth: fillGroup(empty.groups.cognitiveHealth, groups.cognitiveHealth),
      visionAndSymptoms: {
        measurements: visionMeasurements,
        symptoms: symptomState,
      },
      vitalSigns: fillGroup(empty.groups.vitalSigns, groups.vitalSigns),
      spaceEnvironment: fillGroup(empty.groups.spaceEnvironment, groups.spaceEnvironment),
      specializedMedical: fillGroup(empty.groups.specializedMedical, groups.specializedMedical),
    },
    assessmentNotes: record.assessmentNotes || "",
  };
}

function MeasurementInput({
  field,
  measurement,
  error,
  onChange,
}: {
  field: FieldConfig;
  measurement: DraftMeasurement;
  error?: string;
  onChange: (value: Partial<DraftMeasurement>) => void;
}) {
  const id = `assessment-${field.id}`;
  const invalid = Boolean(error);
  return (
    <div className="astronaut-assessment-field">
      <label htmlFor={id}>
        {field.label}
        <span className="assessment-unit">{field.unitOptions ? "select unit" : field.unit}</span>
      </label>
      <div className={`assessment-input-row${field.unitOptions ? " has-unit-picker" : ""}`}>
        {field.kind === "textarea" ? (
          <textarea
            id={id}
            rows={2}
            value={measurement.value}
            onChange={(event) => onChange({ value: event.target.value })}
            aria-invalid={invalid}
            placeholder="Optional result or note"
          />
        ) : field.kind === "select" ? (
          <select
            id={id}
            value={measurement.value}
            onChange={(event) => onChange({ value: event.target.value })}
            aria-invalid={invalid}
          >
            <option value="">Not recorded</option>
            {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : (
          <input
            id={id}
            type={field.kind}
            min={field.kind === "number" ? field.min : undefined}
            max={field.kind === "number" ? field.max : undefined}
            step={field.kind === "number" ? field.step : undefined}
            inputMode={field.kind === "number" ? "decimal" : undefined}
            value={measurement.value}
            onChange={(event) => onChange({ value: event.target.value })}
            aria-invalid={invalid}
            placeholder={field.kind === "number" ? "Optional" : "Select or enter"}
          />
        )}
        {field.unitOptions ? (
          <select
            className="assessment-unit-picker"
            aria-label={`${field.label} unit`}
            value={measurement.unit}
            onChange={(event) => onChange({ unit: event.target.value })}
          >
            {field.unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        ) : field.customUnit ? (
          <input
            className="assessment-custom-unit"
            aria-label={`${field.label} unit`}
            value={measurement.unit}
            onChange={(event) => onChange({ unit: event.target.value })}
            placeholder="Source unit"
          />
        ) : (
          <span className="assessment-unit-chip">{field.kind === "select" ? "SELECT" : field.unit}</span>
        )}
      </div>
      {field.hint && <small className="assessment-field-hint">{field.hint}</small>}
      {error && <span className="assessment-field-error">{error}</span>}
      <details className="measurement-metadata">
        <summary>Time, source &amp; notes</summary>
        <div className="measurement-metadata-grid">
          <div>
            <label htmlFor={`${id}-recorded-at`}>Measurement date &amp; time</label>
            <input
              id={`${id}-recorded-at`}
              type="datetime-local"
              step={60}
              required={Boolean(measurement.value.trim())}
              value={measurement.recordedAt}
              onChange={(event) => onChange({ recordedAt: event.target.value })}
              aria-invalid={Boolean(measurement.value.trim() && !measurement.recordedAt)}
            />
          </div>
          <div>
            <label htmlFor={`${id}-source`}>Data source</label>
            <select
              id={`${id}-source`}
              value={measurement.source}
              onChange={(event) => onChange({ source: event.target.value as MeasurementSource })}
            >
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="measurement-notes-field">
            <label htmlFor={`${id}-notes`}>Optional notes</label>
            <textarea
              id={`${id}-notes`}
              rows={2}
              value={measurement.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
              placeholder="Context for this specific reading"
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export default function HealthAssessmentForm() {
  const [draft, setDraft] = useState<AssessmentDraft>(() => createEmptyDraft(""));

  useEffect(() => {
    setDraft((prev) => {
      if (!prev.assessmentDate) {
        return createEmptyDraft(localDateTimeValue());
      }
      return prev;
    });
  }, []);
  const [records, setRecords] = useState<StructuredAssessmentRecord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [canSaveLocally, setCanSaveLocally] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const [importMessage, setImportMessage] = useState<{ group: ImportGroup; text: string } | null>(null);
  const [submittedRecord, setSubmittedRecord] = useState<StructuredAssessmentRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [backendStatus, setBackendStatus] = useState<"checking" | "connected" | "disconnected">("checking");

  // Today's cumulative totals (multi-submission per day)
  const [todayCumulative, setTodayCumulative] = useState<{
    totalSleepDuration: number;
    totalWaterIntake: number;
    totalExerciseDuration: number;
    logCount: number;
  } | null>(null);

  const fetchTodayCumulative = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/assessments/today`);
      if (res.ok) {
        const data: { daily_cumulative?: { totalSleepDuration: number; totalWaterIntake: number; totalExerciseDuration: number; logCount: number } } = await res.json();
        if (data.daily_cumulative) {
          setTodayCumulative(data.daily_cumulative);
        } else {
          setTodayCumulative(null);
        }
      }
    } catch {
      /* backend offline — ignore */
    }
  }, []);

  // Kaggle AI Qwen 2.5 — status only (URL is read from env/config, not user-configurable)
  const [isKaggleOnline, setIsKaggleOnline] = useState<boolean>(false);
  const [isKaggleChecking, setIsKaggleChecking] = useState<boolean>(true);

  const checkKaggleStatus = useCallback(() => {
    setIsKaggleChecking(true);
    fetch("/api/support/kaggle-url")
      .then((res) => res.json())
      .then((data) => {
        setIsKaggleOnline(Boolean(data.isOnline));
        setIsKaggleChecking(false);
      })
      .catch(() => {
        setIsKaggleOnline(false);
        setIsKaggleChecking(false);
      });
  }, []);

  useEffect(() => {
    checkKaggleStatus();
  }, [checkKaggleStatus]);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(["sleepAndWellness", "vitalSigns"]));
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);
  const [preloadedRecord, setPreloadedRecord] = useState<StructuredAssessmentRecord | null>(null);
  const [isPreloaded, setIsPreloaded] = useState(false);
  const [preloadedDateLabel, setPreloadedDateLabel] = useState("");

  const isSameTime = useMemo(() => {
    if (!preloadedRecord?.assessmentDate || !draft.assessmentDate) return false;
    try {
      const draftMs = new Date(draft.assessmentDate).getTime();
      const prevMs = new Date(preloadedRecord.assessmentDate).getTime();
      return Math.abs(draftMs - prevMs) < 60_000;
    } catch {
      return false;
    }
  }, [preloadedRecord, draft.assessmentDate]);

  // Check backend connectivity on mount
  useEffect(() => {
    let active = true;
    fetch(`${BACKEND_URL}/`)
      .then((res) => {
        if (active) setBackendStatus(res.ok ? "connected" : "disconnected");
      })
      .catch(() => {
        if (active) setBackendStatus("disconnected");
      });
    return () => {
      active = false;
    };
  }, []);

  // Fetch today's cumulative totals on mount
  useEffect(() => {
    void fetchTodayCumulative();
  }, [fetchTodayCumulative]);

  // Read URL query parameter or hash on mount/navigation to automatically expand desired section
  useEffect(() => {
    function handleSectionTarget() {
      const searchParams = new URLSearchParams(window.location.search);
      const querySection = searchParams.get("section");
      const hashSection = window.location.hash.replace("#", "");
      const target = querySection || hashSection;

      if (target && sectionMeta.some((s) => s.id === target)) {
        setOpenSections((current) => new Set([...current, target]));
        setTimeout(() => {
          const element = document.getElementById(target);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 120);
      }
    }

    handleSectionTarget();
    window.addEventListener("hashchange", handleSectionTarget);
    window.addEventListener("popstate", handleSectionTarget);
    return () => {
      window.removeEventListener("hashchange", handleSectionTarget);
      window.removeEventListener("popstate", handleSectionTarget);
    };
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      let loadedRecords: StructuredAssessmentRecord[] = [];

      try {
        const response = await fetch(`${BACKEND_URL}/assessments`);
        if (response.ok) {
          const data: unknown = await response.json();
          const parsed = parseStoredAssessments(
            JSON.stringify({
              version: ASSESSMENT_STORAGE_VERSION,
              records: data,
            })
          );
          loadedRecords = parsed.records;
        }
      } catch (backendErr) {
        console.warn("Backend fetch failed, checking local storage:", backendErr);
      }

      if (loadedRecords.length === 0) {
        const saved = window.localStorage.getItem(ASSESSMENT_STORAGE_KEY);
        if (saved) {
          const parsed = parseStoredAssessments(saved);
          loadedRecords = parsed.records;
        }
      }

      setRecords(loadedRecords);
      setCanSaveLocally(true);
      setStorageError("");

      // Check if an assessment is already recorded for today (local calendar day)
      const now = new Date();
      const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const todayMatches = loadedRecords.filter((r) => {
        try {
          const dt = new Date(r.assessmentDate);
          const rDateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
          return rDateStr === todayDateStr;
        } catch {
          return false;
        }
      });

      if (todayMatches.length > 0) {
        todayMatches.sort(
          (a, b) => new Date(b.assessmentDate).getTime() - new Date(a.assessmentDate).getTime()
        );
        const latestToday = todayMatches[0];
        const draftFromMatch = recordToDraft(latestToday);
        setDraft({
          ...draftFromMatch,
          assessmentDate: localDateTimeValue(),
        });
        setPreloadedRecord(latestToday);
        setExistingRecordId(latestToday.id);
        setIsPreloaded(true);
        setPreloadedDateLabel(formatRecordedDate(latestToday.assessmentDate));
      } else {
        setDraft(createEmptyDraft(localDateTimeValue()));
        setPreloadedRecord(null);
        setExistingRecordId(null);
        setIsPreloaded(false);
        setPreloadedDateLabel("");
      }
    } catch {
      setRecords([]);
      setCanSaveLocally(false);
      setStorageError("Assessments could not be read.");
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      loadRecords();
    }, 0);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ASSESSMENT_STORAGE_KEY || event.key === null) loadRecords();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", loadRecords);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", loadRecords);
    };
  }, [loadRecords]);

  function handleDateChange(newDate: string) {
    const prevDate = draft.assessmentDate;
    setDraft((current) => {
      const updateGroupDates = (group: Record<string, DraftMeasurement>) => {
        const next: Record<string, DraftMeasurement> = {};
        for (const [key, item] of Object.entries(group)) {
          next[key] = {
            ...item,
            recordedAt: (!item.recordedAt || item.recordedAt === prevDate) ? newDate : item.recordedAt,
          };
        }
        return next;
      };

      return {
        ...current,
        assessmentDate: newDate,
        groups: {
          sleepAndWellness: updateGroupDates(current.groups.sleepAndWellness),
          cognitiveHealth: updateGroupDates(current.groups.cognitiveHealth),
          visionAndSymptoms: {
            ...current.groups.visionAndSymptoms,
            measurements: updateGroupDates(current.groups.visionAndSymptoms.measurements),
          },
          vitalSigns: updateGroupDates(current.groups.vitalSigns),
          spaceEnvironment: updateGroupDates(current.groups.spaceEnvironment),
          specializedMedical: updateGroupDates(current.groups.specializedMedical),
        },
      };
    });
    setSubmittedRecord(null);
    setErrors((current) => ({ ...current, assessmentDate: "" }));

    if (!newDate) return;

    try {
      const selectedDay = new Date(newDate).toISOString().slice(0, 10);
      const dayMatches = records.filter((r) => {
        try {
          return new Date(r.assessmentDate).toISOString().slice(0, 10) === selectedDay;
        } catch {
          return false;
        }
      });

      if (dayMatches.length > 0) {
        dayMatches.sort(
          (a, b) => new Date(b.assessmentDate).getTime() - new Date(a.assessmentDate).getTime()
        );
        const match = dayMatches[0];
        const draftFromMatch = recordToDraft(match);
        setDraft({
          ...draftFromMatch,
          assessmentDate: newDate,
        });
        setPreloadedRecord(match);
        setExistingRecordId(match.id);
        setIsPreloaded(true);
        setPreloadedDateLabel(formatRecordedDate(match.assessmentDate));
      } else {
        setPreloadedRecord(null);
        setExistingRecordId(null);
        setIsPreloaded(false);
        setPreloadedDateLabel("");
      }
    } catch {}
  }

  function handleStartBlank() {
    setDraft(createEmptyDraft(localDateTimeValue()));
    setPreloadedRecord(null);
    setExistingRecordId(null);
    setIsPreloaded(false);
    setPreloadedDateLabel("");
    setSubmittedRecord(null);
  }

  const latestRows = useMemo(
    () => submittedRecord ? measurementRows(submittedRecord) : [],
    [submittedRecord],
  );

  function updateMeasurement(
    group: MeasurementGroup | "visionMeasurements",
    fieldId: string,
    change: Partial<DraftMeasurement>,
  ) {
    setDraft((current) => {
      if (group === "visionMeasurements") {
        return {
          ...current,
          groups: {
            ...current.groups,
            visionAndSymptoms: {
              ...current.groups.visionAndSymptoms,
              measurements: {
                ...current.groups.visionAndSymptoms.measurements,
                [fieldId]: { ...current.groups.visionAndSymptoms.measurements[fieldId], ...change },
              },
            },
          },
        };
      }
      return {
        ...current,
        groups: {
          ...current.groups,
          [group]: {
            ...current.groups[group],
            [fieldId]: { ...current.groups[group][fieldId], ...change },
          },
        },
      };
    });
    setSubmittedRecord(null);
    setErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  async function importJson(
    event: ChangeEvent<HTMLInputElement>,
    group: ImportGroup,
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportMessage(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("The import must be a JSON object.");
      }
      const root = parsed as Record<string, unknown>;
      const groups = typeof root.groups === "object" && root.groups !== null
        ? root.groups as Record<string, unknown>
        : root;
      const importedGroup = groups[group];
      if (typeof importedGroup !== "object" || importedGroup === null || Array.isArray(importedGroup)) {
        throw new Error(`The JSON file must contain a "${group}" object.`);
      }
      const values = importedGroup as Record<string, unknown>;
      const fields: readonly FieldConfig[] = sectionFields[group];
      const knownFields = new Map(fields.map((field) => [field.id, field]));
      let applied = 0;
      let invalid = 0;
      let unknown = 0;
      const changes: Record<string, Partial<DraftMeasurement>> = {};
      for (const [key, rawEntry] of Object.entries(values)) {
        const field = knownFields.get(key);
        if (!field) {
          unknown += 1;
          continue;
        }
        const entry =
          typeof rawEntry === "object" && rawEntry !== null && !Array.isArray(rawEntry)
            ? rawEntry as Record<string, unknown>
            : { value: rawEntry };
        if (typeof entry.value !== "string" && typeof entry.value !== "number") {
          invalid += 1;
          continue;
        }
        const value = String(entry.value);
        const validationError = validateField(field, value);
        const unit = typeof entry.unit === "string" ? entry.unit : field.unit;
        if (
          validationError ||
          (field.unitOptions
            ? !field.unitOptions.includes(unit)
            : field.customUnit
              ? !unit.trim()
              : unit !== field.unit)
        ) {
          invalid += 1;
          continue;
        }
        const date = typeof entry.recordedAt === "string" ? new Date(entry.recordedAt) : new Date();
        if (Number.isNaN(date.getTime())) {
          invalid += 1;
          continue;
        }
        changes[key] = {
          value,
          unit,
          recordedAt: localDateTimeValue(date),
          source: "imported",
          notes: typeof entry.notes === "string" ? entry.notes : "",
        };
        applied += 1;
      }
      if (!applied) {
        throw new Error(
          invalid
            ? "No valid readings were imported. Check field names, values and units."
            : "No recognized readings were found in this file.",
        );
      }
      setDraft((current) => ({
        ...current,
        groups: {
          ...current.groups,
          [group]: { ...current.groups[group], ...Object.fromEntries(
            Object.entries(changes).map(([key, change]) => [
              key,
              { ...current.groups[group][key], ...change },
            ]),
          ) },
        },
      }));
      setSubmittedRecord(null);
      setImportMessage({
        group,
        text: `${applied} reading${applied === 1 ? "" : "s"} imported${invalid ? `; ${invalid} invalid item(s) skipped` : ""}${unknown ? `; ${unknown} unrecognized item(s) skipped` : ""}.`,
      });
    } catch (error) {
      setImportMessage({
        group,
        text: error instanceof Error ? error.message : "The JSON file could not be imported.",
      });
    }
  }

  function validateDraft() {
    const nextErrors: Record<string, string> = {};
    for (const [group, fields] of Object.entries(sectionFields)) {
      for (const field of fields) {
        const measurement =
          group === "visionAndSymptoms"
            ? draft.groups.visionAndSymptoms.measurements[field.id]
            : draft.groups[group as MeasurementGroup][field.id];
        if (!measurement) continue;
        const valueError = validateField(field, measurement.value);
        if (valueError) nextErrors[field.id] = valueError;
        if (measurement.value.trim()) {
          if (!measurement.unit.trim()) {
            nextErrors[field.id] = "Enter the unit reported by the source.";
          } else if (!measurement.recordedAt || Number.isNaN(new Date(measurement.recordedAt).getTime())) {
            nextErrors[field.id] = "Enter a valid date and time for this reading.";
          }
        }
      }
    }
    if (!draft.assessmentDate || Number.isNaN(new Date(draft.assessmentDate).getTime())) {
      nextErrors.assessmentDate = "Enter a valid assessment date and time.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStorageError("");
    setBackendError("");

    if (!validateDraft()) return;

    setIsSubmitting(true);

    try {
      // Always generate a fresh UUID for every submission.
      // Sleep, water, and exercise accumulate day-by-day across separate records.
      // The backend sums session_increments for each calendar day, so each
      // new submission correctly adds to (not replaces) today's running total.
      const record: StructuredAssessmentRecord = makeStoredRecord(
        draft,
        undefined, // always new record ID – never reuse the preloaded one
      );

      // Send the assessment to the backend
      const response = await fetch(
        `${BACKEND_URL}/assessments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(record),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        const validationIssues = errorData.detail?.validation_issues;

        if (validationIssues && validationIssues.length > 0) {
          throw new Error(validationIssues.join("\n"));
        }

        throw new Error(
          errorData.detail?.message ||
          "The backend could not save this assessment."
        );
      }

      const resData = await response.json();
      const aiAnalysis = resData.analysis;

      const recordWithAnalysis: StructuredAssessmentRecord = {
        ...record,
        id: resData.assessment_id || record.id,
        analysis: aiAnalysis ?? null,
      };

      // Check if updating an existing record or appending a new one
      let nextRecords = [...records];
      const matchIndex = nextRecords.findIndex(
        (r) => r.id === recordWithAnalysis.id
      );

      if (matchIndex >= 0) {
        nextRecords[matchIndex] = recordWithAnalysis;
      } else {
        nextRecords.push(recordWithAnalysis);
      }

      setRecords(nextRecords);
      setPreloadedRecord(recordWithAnalysis);
      setExistingRecordId(recordWithAnalysis.id);
      setIsPreloaded(true);
      setPreloadedDateLabel(formatRecordedDate(recordWithAnalysis.assessmentDate));

      try {
        window.localStorage.setItem(
          ASSESSMENT_STORAGE_KEY,
          JSON.stringify({
            version: ASSESSMENT_STORAGE_VERSION,
            records: nextRecords,
          })
        );
      } catch (e) {
        console.warn("Local storage cache write skipped:", e);
      }

      setSubmittedRecord(recordWithAnalysis);
      setStorageError("");
      setBackendError("");

      // Refresh today's cumulative totals so the form reflects the new total
      void fetchTodayCumulative();

    } catch (error) {
      console.error("Assessment submission error:", error);

      setBackendError(
        error instanceof Error
          ? error.message
          : `Could not connect to the backend (${BACKEND_URL}). Please ensure the backend is running.`
      );

    } finally {
      setIsSubmitting(false);
    }
  }

  function startNewAssessment() {
    setDraft(createEmptyDraft(localDateTimeValue()));
    setSubmittedRecord(null);
    setExistingRecordId(null);
    setIsPreloaded(false);
    setPreloadedDateLabel("");
    setErrors({});
    setImportMessage(null);
    setStorageError("");
  }

  return (
    <main className="content astronaut-assessment-page">
      <div className="assessment-console">
        <header className="assessment-console-header">
          <div className="assessment-title-block">
            <span className="assessment-orbit-mark" aria-hidden="true">✦</span>
            <div>
              <p className="assessment-eyebrow">ASTRO CODE BLUE / CREW HEALTH RECORD</p>
              <h1>HEALTH SELF-ASSESSMENT</h1>
              <p className="assessment-subtitle">Record your health information and available mission measurements.</p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
            <div className={`assessment-local-status ${backendStatus === "connected" ? "is-connected" : ""}`}>
              <i aria-hidden="true" />
              <span>
                {backendStatus === "connected"
                  ? "FASTAPI BACKEND CONNECTED · SQLITE (astro_code_blue.db)"
                  : backendStatus === "checking"
                  ? "CHECKING BACKEND..."
                  : "BACKEND DISCONNECTED (Run: cd backend && python -m uvicorn main:app --reload --port 8000)"}
              </span>
            </div>

            <button
              type="button"
              className={`assessment-ai-status-pill ${isKaggleOnline ? "is-online" : "is-offline"}`}
              onClick={() => setShowKaggleDrawer((v) => !v)}
              title="Click to view or update Kaggle Qwen 2.5 AI Tunnel URL"
            >
              <span>{isKaggleChecking ? "⏳" : isKaggleOnline ? "🟢" : "🔴"}</span>
              <strong>
                {isKaggleChecking
                  ? "CHECKING KAGGLE AI..."
                  : isKaggleOnline
                  ? "QWEN 2.5 GPU AI: ONLINE"
                  : "KAGGLE AI: OFFLINE (CLICK TO CONFIGURE)"}
              </strong>
              <small style={{ opacity: 0.7 }}>⚙️</small>
            </button>
          </div>
        </header>

        {showKaggleDrawer && (
          <div className="kaggle-config-drawer" role="region" aria-label="Kaggle AI Configuration">
            <div className="kaggle-config-header">
              <strong>✦ KAGGLE AI LINK CONFIGURATION (QWEN 2.5 7B INSTRUCT)</strong>
              <button
                type="button"
                className="kaggle-config-close"
                onClick={() => setShowKaggleDrawer(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "10px", fontFamily: "Intel One Mono, monospace" }}>
              Paste your public Cloudflare Tunnel URL from Kaggle (e.g. <code>https://xxx.trycloudflare.com</code>).
              When running, your assessments will be evaluated directly by the 7B parameter GPU model.
            </p>
            <form onSubmit={handleSaveKaggleUrl} className="kaggle-config-form">
              <div className="kaggle-config-input-row">
                <input
                  type="url"
                  className="kaggle-config-input"
                  placeholder="https://your-tunnel-name.trycloudflare.com"
                  value={inputKaggleUrl}
                  onChange={(e) => setInputKaggleUrl(e.target.value)}
                  required
                />
                <button type="submit" className="kaggle-config-submit-btn" disabled={isSavingKaggle}>
                  {isSavingKaggle ? "TESTING..." : "TEST & CONNECT"}
                </button>
              </div>
              {saveSuccessMsg && <p className="kaggle-config-msg is-success">{saveSuccessMsg}</p>}
              {kaggleError && <p className="kaggle-config-msg is-error">{kaggleError}</p>}
            </form>
          </div>
        )}

        <div className="assessment-intro-strip">
          <div>
            <span className="assessment-section-kicker">CREW DATA COLLECTION</span>
            <p>Enter only information you have observed or measured. Unavailable readings may be left blank.</p>
          </div>
          <span className="assessment-record-count">
            {isLoaded ? `${records.length} SAVED RECORD(S)` : "LOADING..."}
          </span>
        </div>

        {storageError && <p className="assessment-alert" role="alert">{storageError}</p>}

        <form id="health-assessment-form" className="astronaut-assessment-form" onSubmit={handleSubmit} noValidate>
        {backendError && (
          <div className="assessment-alert" role="alert">
            {backendError}
          </div>
        )}

          <section className="assessment-datetime-panel">
            <div>
              <span className="assessment-section-kicker">RECORD METADATA</span>
              <h2>Assessment date &amp; time</h2>
              <p>Use the date and local time the assessment was recorded.</p>
            </div>
            <div className="assessment-datetime-control">
              <div className="assessment-datetime-label-row">
                <label htmlFor="assessment-date-time">Date &amp; time</label>
                <button
                  type="button"
                  className="assessment-now-btn"
                  onClick={() => {
                    const now = localDateTimeValue();
                    setDraft((c) => ({ ...c, assessmentDate: now }));
                    setErrors((c) => ({ ...c, assessmentDate: "" }));
                  }}
                  title="Sync to current system time"
                >
                  ✦ Sync to System Time (Now)
                </button>
              </div>
              <input
                id="assessment-date-time"
                type="datetime-local"
                step={60}
                required
                value={draft.assessmentDate}
                onChange={(event) => handleDateChange(event.target.value)}
                aria-invalid={Boolean(errors.assessmentDate)}
              />
              {errors.assessmentDate && <span className="assessment-field-error">{errors.assessmentDate}</span>}
            </div>
          </section>

          <div className="assessment-sections">
            {sectionMeta.map((section) => {
              const isOpen = openSections.has(section.id);
              return (
                <details
                  id={section.id}
                  className="assessment-section"
                  key={section.id}
                  open={isOpen}
                  onToggle={(e) => {
                    const isCurrentlyOpen = (e.currentTarget as HTMLDetailsElement).open;
                    setOpenSections((current) => {
                      const next = new Set(current);
                      if (isCurrentlyOpen) next.add(section.id);
                      else next.delete(section.id);
                      return next;
                    });
                  }}
                >
                  <summary>
                    <span className="assessment-section-number">{section.number}</span>
                    <span className="assessment-section-summary">
                      <strong>{section.title}</strong>
                      <small>{section.description}</small>
                    </span>
                    <span className="assessment-section-chevron" aria-hidden="true">+</span>
                  </summary>
                  <div className="assessment-section-body">
                    {section.id === "sleepAndWellness" && (
                      <>
                        {/* TODAY'S RUNNING TOTAL BANNER — shown when prior logs exist */}
                        {todayCumulative && todayCumulative.logCount > 0 && (
                          <div className="today-cumulative-banner">
                            <span className="today-banner-kicker">
                              📊 TODAY&apos;S RUNNING TOTAL &mdash; {todayCumulative.logCount} LOG{todayCumulative.logCount > 1 ? "S" : ""} SO FAR
                            </span>
                            <div className="today-banner-metrics">
                              <div className="today-metric-chip">
                                <span className="today-metric-label">💤 SLEEP</span>
                                <span className="today-metric-value">
                                  {todayCumulative.totalSleepDuration} <small>hrs</small>
                                </span>
                                <span
                                  className={`today-metric-status ${
                                    todayCumulative.totalSleepDuration >= 7
                                      ? "status-nominal"
                                      : todayCumulative.totalSleepDuration >= 6
                                      ? "status-caution"
                                      : "status-critical"
                                  }`}
                                >
                                  {todayCumulative.totalSleepDuration >= 7
                                    ? "✓ NOMINAL"
                                    : todayCumulative.totalSleepDuration >= 6
                                    ? "⚠ CAUTION"
                                    : "🔴 CRITICAL"}
                                </span>
                              </div>
                              <div className="today-metric-chip">
                                <span className="today-metric-label">💧 HYDRATION</span>
                                <span className="today-metric-value">
                                  {todayCumulative.totalWaterIntake} <small>L</small>
                                </span>
                                <span
                                  className={`today-metric-status ${
                                    todayCumulative.totalWaterIntake >= 2.5 ? "status-nominal" : "status-caution"
                                  }`}
                                >
                                  {todayCumulative.totalWaterIntake >= 2.5 ? "✓ NOMINAL" : "⚠ CAUTION"}
                                </span>
                              </div>
                              <div className="today-metric-chip">
                                <span className="today-metric-label">🏃 EXERCISE</span>
                                <span className="today-metric-value">
                                  {todayCumulative.totalExerciseDuration} <small>mins</small>
                                </span>
                                <span
                                  className={`today-metric-status ${
                                    todayCumulative.totalExerciseDuration >= 30 ? "status-nominal" : "status-caution"
                                  }`}
                                >
                                  {todayCumulative.totalExerciseDuration >= 30 ? "✓ NOMINAL" : "⚠ LOW"}
                                </span>
                              </div>
                            </div>
                            <p className="today-banner-note">
                              Sleep, water, and exercise values below are <strong>session additions</strong> — they will be added to your running totals above. Vitals are always the latest reading.
                            </p>
                          </div>
                        )}
                        <div className="assessment-guidance-callout exercise-guidance-callout">
                          <strong>🏃 EXERCISE TELEMETRY PROTOCOL</strong>
                          <p>
                            Only enter values for exercise (duration, type) if you completed an exercise session in the moment after your previous submission. Otherwise, leave exercise fields blank.
                          </p>
                        </div>
                        <div className="assessment-field-grid">
                          {sectionFields.sleepAndWellness.map((field) => {
                            const isCumField = field.id === "sleepDuration" || field.id === "waterIntake" || field.id === "exerciseDuration";
                            const sessionVal = parseFloat(draft.groups.sleepAndWellness[field.id]?.value || "0") || 0;
                            const prevTotal =
                              field.id === "sleepDuration"
                                ? (todayCumulative?.totalSleepDuration ?? 0)
                                : field.id === "waterIntake"
                                ? (todayCumulative?.totalWaterIntake ?? 0)
                                : (todayCumulative?.totalExerciseDuration ?? 0);
                            const newTotal = Math.round((prevTotal + sessionVal) * 100) / 100;
                            const showPreview = isCumField && todayCumulative !== null && sessionVal > 0;
                            return (
                              <div key={field.id} className="measurement-input-wrapper">
                                <MeasurementInput
                                  field={field}
                                  measurement={draft.groups.sleepAndWellness[field.id]}
                                  error={errors[field.id]}
                                  onChange={(change) => updateMeasurement("sleepAndWellness", field.id, change)}
                                />
                                {showPreview && (
                                  <div className="today-new-total-preview">
                                    → Today&apos;s total will be:{" "}
                                    <strong>
                                      {newTotal}{" "}
                                      <small>{field.unit}</small>
                                    </strong>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {section.id === "cognitiveHealth" && (
                      <>
                        <div className="assessment-guidance-callout">
                          <strong>WinSCAT is a specialized assessment</strong>
                          <p>WinSCAT takes approximately 11–15 minutes in the supplied research. Enter or import original results only when available; this form does not provide a substitute test or create scores.</p>
                          <label className="assessment-import-button">
                            <span>IMPORT RECORDED RESULTS</span>
                            <input
                              type="file"
                              accept=".json,application/json"
                              onChange={(event) => void importJson(event, "cognitiveHealth")}
                            />
                          </label>
                        </div>
                        <details className="assessment-import-help">
                          <summary>Accepted JSON structure</summary>
                          <p>Use a <code>cognitiveHealth</code> object with field names matching the result inputs. Each value may include <code>value</code>, <code>unit</code>, <code>recordedAt</code> and <code>notes</code>.</p>
                        </details>
                        {importMessage?.group === "cognitiveHealth" && <p className="assessment-import-status" role="status">{importMessage.text}</p>}
                        <div className="assessment-field-grid">
                          {sectionFields.cognitiveHealth.map((field) => (
                            <MeasurementInput
                              key={field.id}
                              field={field}
                              measurement={draft.groups.cognitiveHealth[field.id]}
                              error={errors[field.id]}
                              onChange={(change) => updateMeasurement("cognitiveHealth", field.id, change)}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {section.id === "visionAndSymptoms" && (
                      <>
                        <div className="assessment-field-grid">
                          {sectionFields.visionAndSymptoms.map((field) => (
                            <MeasurementInput
                              key={field.id}
                              field={field}
                              measurement={draft.groups.visionAndSymptoms.measurements[field.id]}
                              error={errors[field.id]}
                              onChange={(change) => updateMeasurement("visionMeasurements", field.id, change)}
                            />
                          ))}
                        </div>
                        <div className="symptom-entry-panel">
                          <div className="symptom-entry-heading">
                            <div>
                              <span className="assessment-section-kicker">SELF-REPORTED</span>
                              <h3>Symptoms to record</h3>
                            </div>
                            <span>Select any that apply</span>
                          </div>
                          <div className="symptom-selector-grid">
                            {symptomNames.map((symptom) => {
                              const entry = draft.groups.visionAndSymptoms.symptoms[symptom];
                              const symptomId = `symptom-${symptom.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
                              return (
                                <div className={`symptom-selector${entry.selected ? " is-selected" : ""}`} key={symptom}>
                                  <label htmlFor={symptomId}>
                                    <input
                                      id={symptomId}
                                      type="checkbox"
                                      checked={entry.selected}
                                      onChange={(event) => {
                                        setDraft((current) => ({
                                          ...current,
                                          groups: {
                                            ...current.groups,
                                            visionAndSymptoms: {
                                              ...current.groups.visionAndSymptoms,
                                              symptoms: {
                                                ...current.groups.visionAndSymptoms.symptoms,
                                                [symptom]: { ...entry, selected: event.target.checked },
                                              },
                                            },
                                          },
                                        }));
                                        setSubmittedRecord(null);
                                      }}
                                    />
                                    <span>{symptom}</span>
                                  </label>
                                  {entry.selected && (
                                    <div className="symptom-details">
                                      <label htmlFor={`${symptomId}-severity`}>Severity</label>
                                      <select
                                        id={`${symptomId}-severity`}
                                        value={entry.severity}
                                        onChange={(event) => {
                                          setDraft((current) => ({
                                            ...current,
                                            groups: {
                                              ...current.groups,
                                              visionAndSymptoms: {
                                                ...current.groups.visionAndSymptoms,
                                                symptoms: {
                                                  ...current.groups.visionAndSymptoms.symptoms,
                                                  [symptom]: { ...entry, severity: event.target.value as SymptomReport["severity"] },
                                                },
                                              },
                                            },
                                          }));
                                          setSubmittedRecord(null);
                                        }}
                                      >
                                        <option value="unspecified">Not specified</option>
                                        <option value="mild">Mild</option>
                                        <option value="moderate">Moderate</option>
                                        <option value="severe">Severe</option>
                                      </select>
                                      <label htmlFor={`${symptomId}-notes`}>Notes</label>
                                      <textarea
                                        id={`${symptomId}-notes`}
                                        rows={2}
                                        value={entry.notes}
                                        placeholder={symptom === "Other symptoms" ? "Describe the symptom" : "Optional details"}
                                        onChange={(event) => {
                                          setDraft((current) => ({
                                            ...current,
                                            groups: {
                                              ...current.groups,
                                              visionAndSymptoms: {
                                                ...current.groups.visionAndSymptoms,
                                                symptoms: {
                                                  ...current.groups.visionAndSymptoms.symptoms,
                                                  [symptom]: { ...entry, notes: event.target.value },
                                                },
                                              },
                                            },
                                          }));
                                          setSubmittedRecord(null);
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="symptom-entry-note">Symptoms are self-reported observations, not diagnoses.</p>
                        </div>
                      </>
                    )}

                    {section.id === "vitalSigns" && (
                      <>
                        <p className="assessment-section-note">Leave any reading blank if the measurement or device is unavailable.</p>
                        <div className="assessment-field-grid">
                          {sectionFields.vitalSigns.map((field) => (
                            <MeasurementInput
                              key={field.id}
                              field={field}
                              measurement={draft.groups.vitalSigns[field.id]}
                              error={errors[field.id]}
                              onChange={(change) => updateMeasurement("vitalSigns", field.id, change)}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {section.id === "spaceEnvironment" && (
                      <>
                        <div className="assessment-guidance-callout">
                          <strong>Use spacecraft sensor or radiation-monitor records</strong>
                          <p>These are environmental readings, not self-estimated values. Import a JSON record or enter values from available monitoring equipment.</p>
                          <label className="assessment-import-button">
                            <span>IMPORT SENSOR RECORD</span>
                            <input
                              type="file"
                              accept=".json,application/json"
                              onChange={(event) => void importJson(event, "spaceEnvironment")}
                            />
                          </label>
                        </div>
                        <details className="assessment-import-help">
                          <summary>Accepted JSON structure</summary>
                          <p>Use a <code>spaceEnvironment</code> object with field names matching the inputs. Each value may include <code>value</code>, <code>unit</code>, <code>recordedAt</code> and <code>notes</code>. Imported readings are labeled as imported.</p>
                        </details>
                        {importMessage?.group === "spaceEnvironment" && <p className="assessment-import-status" role="status">{importMessage.text}</p>}
                        <div className="assessment-field-grid">
                          {sectionFields.spaceEnvironment.map((field) => (
                            <MeasurementInput
                              key={field.id}
                              field={field}
                              measurement={draft.groups.spaceEnvironment[field.id]}
                              error={errors[field.id]}
                              onChange={(change) => updateMeasurement("spaceEnvironment", field.id, change)}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {section.id === "specializedMedical" && (
                      <>
                        <div className="assessment-guidance-callout specialized-note">
                          <strong>Optional professional results only</strong>
                          <p>These assessments require appropriate equipment and professional interpretation. DXA bone-density results are generally obtained pre-flight or post-flight in the supplied research; they are not daily self-assessment inputs.</p>
                        </div>
                        <div className="assessment-field-grid">
                          {sectionFields.specializedMedical.map((field) => (
                            <MeasurementInput
                              key={field.id}
                              field={field}
                              measurement={draft.groups.specializedMedical[field.id]}
                              error={errors[field.id]}
                              onChange={(change) => updateMeasurement("specializedMedical", field.id, change)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                    <div className="section-inline-submit-bar">
                      <span>Entered readings for {section.title.toLowerCase()}?</span>
                      <div className="section-submit-buttons">
                        <button
                          type="submit"
                          form="health-assessment-form"
                          className="assessment-primary-submit-btn"
                          disabled={isSubmitting || Boolean(submittedRecord)}
                        >
                          {isSubmitting
                            ? "Submitting..."
                            : submittedRecord
                            ? "Submitted ✓"
                            : "SUBMIT →"}
                        </button>
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>

          <section className="assessment-notes-panel">
            <label htmlFor="assessment-additional-notes">Additional assessment notes <span>Optional</span></label>
            <textarea
              id="assessment-additional-notes"
              rows={3}
              value={draft.assessmentNotes}
              onChange={(event) => {
                setDraft((current) => ({ ...current, assessmentNotes: event.target.value }));
                setSubmittedRecord(null);
              }}
              placeholder="Add context that does not fit a specific measurement."
            />
          </section>

          <div className="assessment-form-footer">
            <p><i aria-hidden="true" /> Missing values remain blank; no measurements are inferred or replaced with zero.</p>
            <div className="assessment-footer-buttons">
              {submittedRecord && (
                <button className="assessment-secondary-button" type="button" onClick={startNewAssessment}>
                  NEW ASSESSMENT
                </button>
              )}
              <button
                id="main-submit-button"
                className="assessment-primary-submit-btn large"
                type="submit"
                disabled={isSubmitting || Boolean(submittedRecord)}
              >
                {isSubmitting
                  ? "SUBMITTING..."
                  : submittedRecord
                  ? "SAVED ✓"
                  : "SUBMIT →"}
              </button>
            </div>
          </div>
          <p className="assessment-storage-disclaimer">
            Entries are saved directly to the backend SQLite database (astro_code_blue.db).
          </p>
        </form>

        {submittedRecord && (
          <section className="assessment-submission-summary" role="status" aria-live="polite" aria-labelledby="assessment-submission-title">
            <div className="submission-success-mark" aria-hidden="true">✓</div>
            <div className="submission-summary-content">
              <div className="submission-header-row">
                <div>
                  <span className="assessment-section-kicker">DATABASE RECORD SAVED &amp; ANALYZED</span>
                  <h2 id="assessment-submission-title">Clinical Telemetry &amp; AI Analysis</h2>
                  <div style={{ marginTop: "4px" }}>
                    {submittedRecord.analysis?.ai_status === "connected" ? (
                      <span className="engine-source-badge is-ai">
                        🟢 GENERATED BY QWEN 2.5 7B INSTRUCT (KAGGLE GPU LIVE)
                      </span>
                    ) : (
                      <span className="engine-source-badge is-fallback">
                        🟡 GENERATED BY FLIGHT SURGEON LOCAL PROTOCOL (Kaggle AI Offline — Local Fallback Active)
                      </span>
                    )}
                  </div>
                </div>
                {submittedRecord.analysis?.overall_health_status && (
                  <span
                    className={`ai-status-badge status-${submittedRecord.analysis.overall_health_status.toLowerCase()}`}
                  >
                    STATUS: {submittedRecord.analysis.overall_health_status.toUpperCase()}
                  </span>
                )}
              </div>

              {submittedRecord.analysis?.overall_summary && (
                <div className="ai-summary-callout">
                  <strong>CLINICAL OVERVIEW:</strong>
                  <p>{submittedRecord.analysis.overall_summary}</p>
                </div>
              )}

              {/* Today's Accumulated Totals (multi-submission) */}
              {todayCumulative && todayCumulative.logCount > 0 && (
                <div className="submission-daily-totals">
                  <span className="totals-kicker">
                    📊 TODAY&apos;S ACCUMULATED TOTALS &mdash; {todayCumulative.logCount} SUBMISSION{todayCumulative.logCount > 1 ? "S" : ""} TODAY
                  </span>
                  <div className="totals-row">
                    <div className="totals-metric">
                      <span className="totals-icon">💤</span>
                      <span className="totals-label">Sleep</span>
                      <strong className="totals-value">{todayCumulative.totalSleepDuration} <small>hrs</small></strong>
                      <span
                        className={`totals-status-tag ${
                          todayCumulative.totalSleepDuration >= 7
                            ? "status-nominal"
                            : todayCumulative.totalSleepDuration >= 6
                            ? "status-caution"
                            : "status-critical"
                        }`}
                      >
                        {todayCumulative.totalSleepDuration >= 7 ? "NOMINAL" : todayCumulative.totalSleepDuration >= 6 ? "CAUTION" : "CRITICAL"}
                      </span>
                    </div>
                    <div className="totals-metric">
                      <span className="totals-icon">💧</span>
                      <span className="totals-label">Hydration</span>
                      <strong className="totals-value">{todayCumulative.totalWaterIntake} <small>L</small></strong>
                      <span className={`totals-status-tag ${todayCumulative.totalWaterIntake >= 2.5 ? "status-nominal" : "status-caution"}`}>
                        {todayCumulative.totalWaterIntake >= 2.5 ? "NOMINAL" : "CAUTION"}
                      </span>
                    </div>
                    <div className="totals-metric">
                      <span className="totals-icon">🏃</span>
                      <span className="totals-label">Exercise</span>
                      <strong className="totals-value">{todayCumulative.totalExerciseDuration} <small>mins</small></strong>
                      <span className={`totals-status-tag ${todayCumulative.totalExerciseDuration >= 30 ? "status-nominal" : "status-caution"}`}>
                        {todayCumulative.totalExerciseDuration >= 30 ? "NOMINAL" : "LOW"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Medical Assistance Recommendation */}
              {submittedRecord.analysis?.medical_alert && (
                <div
                  className={`ai-medical-alert-card severity-${
                    submittedRecord.analysis.medical_alert.severity || "low"
                  }`}
                >
                  <div className="alert-title-row">
                    <strong>
                      {submittedRecord.analysis.medical_alert.seek_medical_support
                        ? "⚠️ FLIGHT SURGEON MEDICAL CONSULTATION ADVISED"
                        : "✓ STATUS NOMINAL — NO MEDICAL CONSULTATION REQUIRED"}
                    </strong>
                    <span className="alert-severity-pill">
                      SEVERITY: {(submittedRecord.analysis.medical_alert.severity || "LOW").toUpperCase()}
                    </span>
                  </div>
                  {submittedRecord.analysis.medical_alert.advice && (
                    <p className="alert-advice-text">
                      {submittedRecord.analysis.medical_alert.advice}
                    </p>
                  )}
                </div>
              )}

              {/* Analysed Overview of Each Section */}
              {submittedRecord.analysis?.section_statuses && (
                <div className="ai-sections-overview">
                  <h3 className="ai-block-heading">SECTION-BY-SECTION ANALYSIS OVERVIEW</h3>
                  <div className="ai-section-cards-grid">
                    {sectionMeta.map((section) => {
                      const sectionAnalysis =
                        submittedRecord.analysis?.section_statuses?.[section.id];
                      const status = sectionAnalysis?.status || "Nominal";
                      const findings =
                        sectionAnalysis?.findings ||
                        "Readings within baseline thresholds.";

                      return (
                        <div className={`ai-section-card status-${status.toLowerCase()}`} key={section.id}>
                          <div className="ai-section-card-top">
                            <span className="section-name">{section.title}</span>
                            <span className={`section-status-tag status-${status.toLowerCase()}`}>
                              {status.toUpperCase()}
                            </span>
                          </div>
                          <p className="section-findings">{findings}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recommended Countermeasure Exercises */}
              {submittedRecord.analysis?.exercises && submittedRecord.analysis.exercises.length > 0 && (
                <div className="ai-exercises-block">
                  <h3 className="ai-block-heading">RECOMMENDED COUNTERMEASURE EXERCISES</h3>
                  <div className="ai-exercises-grid">
                    {submittedRecord.analysis.exercises.map((ex, idx) => (
                      <div className="ai-exercise-card" key={idx}>
                        <div className="exercise-card-header">
                          <span className="exercise-glyph">⚡</span>
                          <strong>{ex.name}</strong>
                          <span className="exercise-duration">{ex.duration}</span>
                        </div>
                        <p className="exercise-purpose">{ex.purpose}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Healthcare & Operational Suggestions */}
              {submittedRecord.analysis?.healthcare_suggestions &&
                submittedRecord.analysis.healthcare_suggestions.length > 0 && (
                  <div className="ai-suggestions-block">
                    <h3 className="ai-block-heading">HEALTHCARE &amp; PHYSIOLOGICAL SUGGESTIONS</h3>
                    <ul className="ai-suggestions-list">
                      {submittedRecord.analysis.healthcare_suggestions.map((sug, idx) => (
                        <li key={idx}>{sug}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Raw Saved Readings */}
              <div className="ai-raw-telemetry-block">
                <h3 className="ai-block-heading">
                  RECORDED MEASUREMENTS ({countRecordedValues(submittedRecord)} items saved at{" "}
                  {formatRecordedDate(submittedRecord.submittedAt)})
                </h3>
                {latestRows.length > 0 ? (
                  <div className="submission-measurement-list">
                    {latestRows.map((row, index) => (
                      <div className="submission-measurement-row" key={`${row.label}-${index}`}>
                        <span>{row.label}<small>{row.group}</small></span>
                        <strong>{row.value} <small>{row.unit}</small></strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="submission-empty-summary">No measurement values were entered.</p>
                )}
                {submittedRecord.groups.visionAndSymptoms.symptoms.length > 0 && (
                  <div className="submission-symptoms">
                    <strong>SELF-REPORTED SYMPTOMS</strong>
                    <span>
                      {submittedRecord.groups.visionAndSymptoms.symptoms
                        .map((item) => `${item.symptom} · ${item.severity}`)
                        .join(" / ")}
                    </span>
                  </div>
                )}
              </div>

              <div className="submission-actions">
                <Link href="/">RETURN TO OVERVIEW DASHBOARD <span aria-hidden="true">↗</span></Link>
                <Link href="/trends">VIEW HEALTH TRENDS <span aria-hidden="true">↗</span></Link>
                <button type="button" className="assessment-secondary-action-btn" onClick={startNewAssessment}>
                  + Record Another Assessment
                </button>
              </div>
            </div>
          </section>
        )}

        <details className="assessment-history">
          <summary>
            <span className="assessment-history-emblem" aria-hidden="true">⌁</span>
            <span>
              <small className="assessment-section-kicker">LOCAL RECORD ARCHIVE</small>
              <strong>Assessment history</strong>
              <small>{isLoaded ? `${records.length} saved record(s)` : "Loading saved assessments"}</small>
            </span>
            <i aria-hidden="true">+</i>
          </summary>
          {!isLoaded ? (
            <p className="assessment-history-empty">Loading saved records…</p>
          ) : records.length === 0 ? (
            <p className="assessment-history-empty">No saved assessments yet. Saved records will appear here.</p>
          ) : (
            <ol className="assessment-history-list">
              {[...records].reverse().map((record) => {
                const rows = measurementRows(record);
                return (
                  <li key={record.id}>
                    <details>
                      <summary>
                        <span className="assessment-history-date">{formatRecordedDate(record.assessmentDate)}</span>
                        <span>{countRecordedValues(record)} recorded item(s)</span>
                        <i aria-hidden="true">+</i>
                      </summary>
                      {rows.length ? (
                        <div className="assessment-history-values">
                          {rows.map((row, index) => (
                            <div key={`${record.id}-${row.label}-${index}`}>
                              <span>{row.label}</span>
                              <strong>{row.value} <small>{row.unit}</small></strong>
                              <small>{formatRecordedDate(row.recordedAt)} · {row.source}</small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="assessment-history-empty">No measurement values were recorded.</p>
                      )}
                      {record.groups.visionAndSymptoms.symptoms.length > 0 && (
                        <p className="assessment-history-symptoms">
                          Self-reported symptoms: {record.groups.visionAndSymptoms.symptoms.map((symptom) => symptom.symptom).join(", ")}
                        </p>
                      )}
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </details>

        <details className="assessment-research-note">
          <summary>RESEARCH &amp; DATA BOUNDARIES <span aria-hidden="true">+</span></summary>
          <p>Assessment domains follow the supplied NASA HRP research context and this project&apos;s provided indicators. Values are recorded as entered; this form applies no NASA thresholds, diagnoses, or medication recommendations. Research schedules and specialized tests are context only and do not replace current mission procedures or professional assessment.</p>
        </details>

        <aside className="assessment-sticky-bar" aria-label="Assessment Quick Actions">
          <div className="sticky-bar-content">
            <div className="sticky-info">
              <span className="sticky-dot" />
              <strong>ASTRO CODE BLUE</strong>
              <small>• SQLite Telemetry Submission</small>
            </div>
            <div className="sticky-actions">
              {submittedRecord ? (
                <button
                  type="button"
                  className="assessment-primary-submit-btn is-success"
                  onClick={startNewAssessment}
                >
                  ✓ Saved · Start New Assessment
                </button>
              ) : (
                <button
                  type="submit"
                  form="health-assessment-form"
                  className="assessment-primary-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting..." : "SUBMIT →"}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
