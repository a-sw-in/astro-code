export type TrendMetricComparison = {
  metric: string;
  previous: number;
  current: number;
  unit: string;
  delta: number;
  percent: number;
  trend: "improving" | "degrading" | "stable";
};

export type TrendEvaluation = {
  direction: "gradually_improving" | "gradually_degrading" | "stable" | "insufficient_data";
  direction_label: string;
  net_improvement_percent: number;
  summary: string;
  metric_comparisons: TrendMetricComparison[];
};

export type HealthFocusArea = {
  area: string;
  priority: "CRITICAL" | "HIGH" | "MODERATE" | "ROUTINE";
  target: string;
  reason: string;
  action: string;
  sectionId?: string;
};

export type SubmissionSession = {
  report_number: number;
  time?: string;
  session_value: number;
  unit?: string;
};

export type MetricSubmissionsBreakdown = {
  sessions: SubmissionSession[];
  total_today: number;
  unit: string;
  summary_text: string;
};

export type DailySubmissionsBreakdown = {
  date: string;
  submission_count: number;
  sleep: MetricSubmissionsBreakdown;
  water: MetricSubmissionsBreakdown;
  exercise: MetricSubmissionsBreakdown;
};

export type DailyAggregates = {
  date?: string;
  log_count: number;
  total_sleep: number;
  sleep_logs?: number[];
  total_water: number;
  water_logs?: number[];
  total_exercise: number;
  exercise_logs?: number[];
  submissions_breakdown?: DailySubmissionsBreakdown;
};

export type ExercisePrescription = {
  name: string;
  category?: string;
  duration: string;
  intensity?: string;
  target?: string;
  purpose: string;
  protocol?: string;
};

export type AssessmentAnalysis = {
  assessment_id: string;
  measurements_analyzed: number;
  insights: string[];
  historical_changes: string[];
  ai_status?: string;
  overall_health_status?: "Nominal" | "Caution" | "Critical";
  overall_summary?: string;
  medical_alert?: {
    severity?: string;
    seek_medical_support?: boolean;
    advice?: string;
  };
  section_statuses?: Record<string, { status: string; findings: string }>;
  exercises?: ExercisePrescription[];
  healthcare_suggestions?: string[];
  trend_evaluation?: TrendEvaluation;
  all_time_evaluation?: TrendEvaluation & { assessment_count?: number };
  period_trends?: Record<string, TrendEvaluation & { assessment_count?: number }>;
  daily_aggregates?: DailyAggregates;
  today_submissions_breakdown?: DailySubmissionsBreakdown;
  focus_areas?: HealthFocusArea[];
};

export type AssessmentRecord = {
  assessmentDate?: string;
  heartRate: string;
  systolic: string;
  diastolic: string;
  oxygenSaturation: string;
  bodyTemperature: string;
  sleepDuration: string;
  waterIntake: string;
  exerciseDuration?: string;
  observations: string;
  submittedAt: string;
  analysis?: AssessmentAnalysis | null;
};

export type SimulatedHealthRecord = AssessmentRecord & {
  day: string;
};

export const SIMULATED_HEALTH_DATA: readonly SimulatedHealthRecord[] = [];

export const SIMULATED_LATEST_HEALTH: SimulatedHealthRecord | null = null;
