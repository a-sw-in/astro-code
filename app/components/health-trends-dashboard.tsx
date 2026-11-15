"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type AssessmentRecord,
} from "../data/health-data";

import {
  ASSESSMENT_STORAGE_KEY,
  parseStoredAssessments,
  toAssessmentRecord,
} from "../data/health-assessments";

type TimeRange = "24h" | "7d" | "30d" | "all";
type MetricField = "sleepDuration" | "heartRate" | "oxygenSaturation" | "waterIntake";
type TrendField =
  | MetricField
  | "systolic"
  | "diastolic"
  | "bodyTemperature";
type DisplayRecord = {
  record: AssessmentRecord;
  sampleDay: string | null;
  timestamp: number | null;
  dateLabel: string;
  chartLabel: string;
  key: string;
};
type TrendPoint = Record<TrendField, number | null> & {
  dateLabel: string;
};
type ChartSeries = {
  dataKey: TrendField;
  name: string;
  color: string;
  unit: string;
};

const timeRanges: { id: TimeRange; label: string; duration: number | null }[] = [
  { id: "24h", label: "Last 24 hours", duration: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "Last 7 days", duration: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "Last 30 days", duration: 30 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All records", duration: null },
];

const summaryMetrics: { field: MetricField; label: string; unit: string; glyph: string }[] = [
  { field: "sleepDuration", label: "Sleep duration", unit: "HRS", glyph: "◷" },
  { field: "heartRate", label: "Heart rate", unit: "BPM", glyph: "♡" },
  { field: "oxygenSaturation", label: "Oxygen saturation", unit: "%", glyph: "◉" },
  { field: "waterIntake", label: "Water intake", unit: "L", glyph: "◌" },
];

const chartDefinitions: {
  title: string;
  description: string;
  unit: string;
  series: ChartSeries[];
}[] = [
  {
    title: "Sleep duration",
    description: "Recorded hours of sleep",
    unit: "HOURS",
    series: [{ dataKey: "sleepDuration", name: "Sleep", color: "#00d4ff", unit: "hrs" }],
  },
  {
    title: "Heart rate",
    description: "Recorded heart rate",
    unit: "BPM",
    series: [{ dataKey: "heartRate", name: "Heart rate", color: "#168bff", unit: "BPM" }],
  },
  {
    title: "Oxygen saturation",
    description: "Recorded oxygen saturation",
    unit: "%",
    series: [{ dataKey: "oxygenSaturation", name: "Oxygen saturation", color: "#00d4ff", unit: "%" }],
  },
  {
    title: "Water intake",
    description: "Recorded daily water intake",
    unit: "LITRES",
    series: [{ dataKey: "waterIntake", name: "Water intake", color: "#39bdf8", unit: "L" }],
  },
  {
    title: "Blood pressure",
    description: "Recorded systolic and diastolic measurements",
    unit: "MMHG",
    series: [
      { dataKey: "systolic", name: "Systolic", color: "#00d4ff", unit: "mmHg" },
      { dataKey: "diastolic", name: "Diastolic", color: "#168bff", unit: "mmHg" },
    ],
  },
  {
    title: "Body temperature",
    description: "Recorded body temperature",
    unit: "°C",
    series: [{ dataKey: "bodyTemperature", name: "Body temperature", color: "#39bdf8", unit: "°C" }],
  },
];

function parseRecordDate(record: AssessmentRecord): Date | null {
  const rawDate = record.assessmentDate?.trim() || record.submittedAt.trim();
  if (!rawDate) return null;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRecordDate(record: AssessmentRecord) {
  const date = parseRecordDate(record);
  if (!date) return "N/A";
  const options: Intl.DateTimeFormatOptions =
    record.assessmentDate?.includes("T") || !record.assessmentDate?.trim()
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatChartDate(record: AssessmentRecord) {
  const date = parseRecordDate(record);
  if (!date) return "N/A";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function parseMeasurement(record: AssessmentRecord, field: TrendField): number | null {
  const rawValue = record[field].trim();
  if (!rawValue) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function makeDisplayRecord(
  record: AssessmentRecord,
  index: number,
): DisplayRecord {
  const date = parseRecordDate(record);
  return {
    record,
    sampleDay: null,
    timestamp: date?.getTime() ?? null,
    dateLabel: formatRecordDate(record),
    chartLabel: formatChartDate(record),
    key: `${record.submittedAt || record.assessmentDate || "assessment"}-${index}`,
  };
}

function computeClientPeriodTrend(entries: DisplayRecord[], period: TimeRange) {
  const periodTitles: Record<TimeRange, string> = {
    "24h": "24-Hour Diurnal",
    "7d": "7-Day Clinical",
    "30d": "30-Day Physiological",
    "all": "All-Time Mission",
  };
  const title = periodTitles[period] || "Period";

  if (entries.length === 0) {
    return {
      period,
      direction: "insufficient_data",
      direction_label: "NO TELEMETRY IN PERIOD",
      net_improvement_percent: 0,
      summary: `No assessment records found for ${timeRanges.find((r) => r.id === period)?.label || period}. Complete an assessment to begin tracking.`,
      metric_comparisons: [],
    };
  }

  if (entries.length === 1) {
    return {
      period,
      direction: "baseline",
      direction_label: "BASELINE ESTABLISHED",
      net_improvement_percent: 0,
      summary: `1 assessment logged in this period. Flight baseline telemetry established.`,
      metric_comparisons: [],
    };
  }

  const baseline = entries[0].record;
  const current = entries[entries.length - 1].record;

  const metricDefs: { field: TrendField; name: string; unit: string; optimal?: number }[] = [
    { field: "sleepDuration", name: "Sleep duration", unit: "hrs" },
    { field: "waterIntake", name: "Water intake", unit: "L" },
    { field: "oxygenSaturation", name: "Oxygen saturation", unit: "%" },
    { field: "heartRate", name: "Heart rate", unit: "BPM", optimal: 70 },
    { field: "systolic", name: "Systolic blood pressure", unit: "mmHg", optimal: 120 },
    { field: "diastolic", name: "Diastolic blood pressure", unit: "mmHg", optimal: 80 },
    { field: "bodyTemperature", name: "Body temperature", unit: "°C", optimal: 36.8 },
  ];

  const comparisons: any[] = [];
  const scores: number[] = [];

  for (const m of metricDefs) {
    const prev = parseMeasurement(baseline, m.field);
    const curr = parseMeasurement(current, m.field);
    if (prev === null || curr === null || prev === 0) continue;

    const delta = Math.round((curr - prev) * 10) / 10;
    const rawPct = Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
    let trend: "improving" | "degrading" | "stable" = "stable";
    let score = 0;

    if (m.field === "sleepDuration") {
      comparisons.push({
        metric: m.name,
        previous: prev,
        current: curr,
        unit: m.unit,
        delta,
        percent: null,
        trend: "neutral",
        is_sleep: true,
      });
      continue;
    }

    if (m.optimal !== undefined) {
      const prevDist = Math.abs(prev - m.optimal);
      const currDist = Math.abs(curr - m.optimal);
      if (currDist < prevDist) {
        trend = "improving";
        score = Math.abs(rawPct);
      } else if (currDist > prevDist) {
        trend = "degrading";
        score = -Math.abs(rawPct);
      }
    } else {
      if (delta > 0) {
        trend = "improving";
        score = rawPct;
      } else if (delta < 0) {
        trend = "degrading";
        score = rawPct;
      }
    }

    scores.push(score);
    comparisons.push({
      metric: m.name,
      previous: prev,
      current: curr,
      unit: m.unit,
      delta,
      percent: rawPct,
      trend,
    });
  }

  const netPct = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  const direction = netPct >= 2 ? "gradually_improving" : netPct <= -2 ? "gradually_degrading" : "stable";
  const direction_label = netPct >= 2 ? `${title.toUpperCase()} PROGRESSION (+${netPct}%)` : netPct <= -2 ? `${title.toUpperCase()} PROGRESSION (${netPct}%)` : `${title.toUpperCase()} STABLE (${netPct >= 0 ? "+" : ""}${netPct}%)`;
  const summary = netPct >= 2
    ? `Across ${entries.length} logs in this period, astronaut physiological markers reflect positive +${netPct}% improvement. Circulation, hydration, and restorative sleep demonstrate healthy flight adaptation.`
    : netPct <= -2
    ? `Across ${entries.length} logs in this period, astronaut telemetry indicates a ${netPct}% downward drift. Focus attention on rest, hydration, and countermeasure routines.`
    : `Across ${entries.length} logs in this period, astronaut physiological indicators remain stable within nominal microgravity flight baseline.`;

  return {
    period,
    direction,
    direction_label,
    net_improvement_percent: netPct,
    summary,
    metric_comparisons: comparisons,
  };
}

function HealthTrendChart({
  title,
  description,
  unit,
  data,
  series,
}: {
  title: string;
  description: string;
  unit: string;
  data: TrendPoint[];
  series: ChartSeries[];
}) {
  const hasMeasurements = data.some((point) =>
    series.some((item) => point[item.dataKey] !== null),
  );

  return (
    <article className="trend-chart-card">
      <header className="trend-chart-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{unit}</span>
      </header>
      {hasMeasurements ? (
        <div className="trend-chart-plot">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid stroke="rgba(146, 174, 202, 0.12)" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                axisLine={{ stroke: "rgba(146, 174, 202, 0.18)" }}
                tickLine={false}
                tick={{ fill: "#8295aa", fontSize: 10 }}
                minTickGap={18}
              />
              <YAxis
                domain={["auto", "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#8295aa", fontSize: 10 }}
                width={46}
              />
              <Tooltip
                contentStyle={{
                  border: "1px solid rgba(0, 212, 255, 0.36)",
                  borderRadius: 6,
                  background: "rgba(4, 17, 34, 0.96)",
                  color: "#eff8ff",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#75dff5" }}
                formatter={(value, name) => [`${value ?? "—"}`, name]}
              />
              {series.length > 1 && (
                <Legend
                  wrapperStyle={{ color: "#9badbf", fontSize: 10 }}
                  iconType="circle"
                  iconSize={7}
                />
              )}
              {series.map((item) => (
                <Line
                  key={item.dataKey}
                  type="monotone"
                  dataKey={item.dataKey}
                  name={item.name}
                  unit={item.unit}
                  stroke={item.color}
                  strokeWidth={2}
                  dot={{ r: 2, fill: item.color, strokeWidth: 0 }}
                  activeDot={{ r: 4, stroke: "#dffaff", strokeWidth: 1 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="trend-chart-empty">No readings for this metric in the selected period.</div>
      )}
    </article>
  );
}


function getChangeDirection(change: string) {
  const normalized = change.toLowerCase();

  if (normalized.includes("increased")) {
    return "increased";
  }

  if (normalized.includes("decreased")) {
    return "decreased";
  }

  return "changed";
}


export default function HealthTrendsDashboard() {
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [period, setPeriod] = useState<TimeRange>("24h");
  const [isLoading, setIsLoading] = useState(true);
  const [invalidCount, setInvalidCount] = useState(0);
  const [storageError, setStorageError] = useState("");
  const [inspectedEntry, setInspectedEntry] = useState<DisplayRecord | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [periodTrends, setPeriodTrends] = useState<Record<string, any>>({});
  const [aiOverview, setAiOverview] = useState<string>("");

  const loadAssessments = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/assessments"
      );

      if (!response.ok) {
        throw new Error("Could not retrieve assessments from the backend.");
      }

      const data: unknown = await response.json();

      // Validate the records using the existing assessment parser
      const parsed = parseStoredAssessments(
        JSON.stringify({
          version: 2,
          records: data,
        })
      );

      setRecords(parsed.records.map(toAssessmentRecord));
      setInvalidCount(parsed.invalidCount);
      setStorageError("");

      // Fetch multi-period trend trajectories (24h, 7d, 30d, all)
      try {
        const pRes = await fetch("http://127.0.0.1:8000/api/trends/periods");
        if (pRes.ok) {
          const pData = await pRes.json();
          setPeriodTrends(pData);
          if (pData.ai_overview) setAiOverview(pData.ai_overview);
        }
      } catch (pErr) {
        console.warn("Could not retrieve period trends:", pErr);
      }
    } catch (error) {
      console.error("Error loading assessments:", error);

      setRecords([]);
      setInvalidCount(0);
      setStorageError(
        "Could not load assessments from the backend. Please check your connection."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);


  useEffect(() => {
    const initialLoad = window.setTimeout(loadAssessments, 0);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ASSESSMENT_STORAGE_KEY || event.key === null) loadAssessments();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadAssessments();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", loadAssessments);
    window.addEventListener("pageshow", loadAssessments);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", loadAssessments);
      window.removeEventListener("pageshow", loadAssessments);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadAssessments]);

  useEffect(() => {
    const updateTime = () => setCurrentTime(Date.now());
    const initialUpdate = window.setTimeout(updateTime, 0);
    const updateInterval = window.setInterval(updateTime, 60_000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(updateInterval);
    };
  }, []);

  useEffect(() => {
    if (!inspectedEntry) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectedEntry(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [inspectedEntry]);

  const hasSavedAssessments = records.length > 0;
  const allEntries = useMemo(() => {
    if (hasSavedAssessments) {
      return records.map((record, index) => makeDisplayRecord(record, index));
    }
    return [];
  }, [hasSavedAssessments, records]);

  const filteredEntries = useMemo(() => {
    if (!hasSavedAssessments) {
      return [];
    }

    const sorted = [...allEntries].sort((a, b) => {
      if (a.timestamp === null) return b.timestamp === null ? 0 : -1;
      if (b.timestamp === null) return 1;
      return a.timestamp - b.timestamp;
    });
    const selectedRange = timeRanges.find((range) => range.id === period);
    if (!selectedRange?.duration) return sorted;
    if (currentTime === 0) return [];
    const now = currentTime;
    const cutoff = now - selectedRange.duration;
    return sorted.filter((entry) =>
      entry.timestamp !== null && entry.timestamp >= cutoff && entry.timestamp <= now,
    );
  }, [allEntries, currentTime, hasSavedAssessments, period]);

  const chartData = useMemo<TrendPoint[]>(() => {
    if (period === "24h") {
      // Show each individual reading to track intraday drift
      return filteredEntries.map(({ record, chartLabel }) => ({
        dateLabel: chartLabel,
        sleepDuration: parseMeasurement(record, "sleepDuration"),
        heartRate: parseMeasurement(record, "heartRate"),
        oxygenSaturation: parseMeasurement(record, "oxygenSaturation"),
        waterIntake: parseMeasurement(record, "waterIntake"),
        systolic: parseMeasurement(record, "systolic"),
        diastolic: parseMeasurement(record, "diastolic"),
        bodyTemperature: parseMeasurement(record, "bodyTemperature"),
      }));
    }

    // For multi-day periods (7d, 30d, all): group by calendar day so cumulative metrics (sleep, water) are added together
    const dayMap = new Map<
      string,
      {
        label: string;
        sleep: number;
        water: number;
        hr: number | null;
        ox: number | null;
        sys: number | null;
        dia: number | null;
        temp: number | null;
      }
    >();

    for (const { record, chartLabel, timestamp } of filteredEntries) {
      const dayKey = timestamp ? new Date(timestamp).toISOString().slice(0, 10) : chartLabel;
      const existing = dayMap.get(dayKey);

      const s = parseMeasurement(record, "sleepDuration") || 0;
      const w = parseMeasurement(record, "waterIntake") || 0;
      const hr = parseMeasurement(record, "heartRate");
      const ox = parseMeasurement(record, "oxygenSaturation");
      const sys = parseMeasurement(record, "systolic");
      const dia = parseMeasurement(record, "diastolic");
      const temp = parseMeasurement(record, "bodyTemperature");

      if (existing) {
        existing.sleep = Math.round((existing.sleep + s) * 10) / 10;
        existing.water = Math.round((existing.water + w) * 10) / 10;
        if (hr !== null) existing.hr = hr;
        if (ox !== null) existing.ox = ox;
        if (sys !== null) existing.sys = sys;
        if (dia !== null) existing.dia = dia;
        if (temp !== null) existing.temp = temp;
      } else {
        dayMap.set(dayKey, {
          label: chartLabel,
          sleep: s,
          water: w,
          hr,
          ox,
          sys,
          dia,
          temp,
        });
      }
    }

    return Array.from(dayMap.values()).map((d) => ({
      dateLabel: d.label,
      sleepDuration: d.sleep > 0 ? d.sleep : null,
      heartRate: d.hr,
      oxygenSaturation: d.ox,
      waterIntake: d.water > 0 ? d.water : null,
      systolic: d.sys,
      diastolic: d.dia,
      bodyTemperature: d.temp,
    }));
  }, [filteredEntries, period]);

  const latestMetricEntries = summaryMetrics.map((metric) => {
    const latest = [...filteredEntries].reverse().find(
      (entry) => parseMeasurement(entry.record, metric.field) !== null,
    );

    // Sum cumulative metrics across all logs of the latest day
    if (
      (metric.field === "sleepDuration" || metric.field === "waterIntake") &&
      filteredEntries.length > 0 &&
      latest
    ) {
      const targetDay = latest.timestamp
        ? new Date(latest.timestamp).toISOString().slice(0, 10)
        : null;

      if (targetDay) {
        let sum = 0;
        let count = 0;
        for (const entry of filteredEntries) {
          const eDay = entry.timestamp
            ? new Date(entry.timestamp).toISOString().slice(0, 10)
            : null;
          if (eDay === targetDay) {
            const v = parseMeasurement(entry.record, metric.field);
            if (v !== null) {
              sum += v;
              count += 1;
            }
          }
        }

        if (count > 1) {
          const clonedRecord = {
            ...latest.record,
            [metric.field]: String(Math.round(sum * 10) / 10),
          };
          return {
            ...metric,
            entry: {
              ...latest,
              record: clonedRecord,
              dateLabel: `${latest.dateLabel} (${count} logs combined)`,
            },
          };
        }
      }
    }

    return { ...metric, entry: latest };
  });

  const latestAnalysisEntry = [...filteredEntries]
  .reverse()
  .find((entry) => entry.record.analysis != null);

const latestAnalysis = latestAnalysisEntry?.record.analysis;

  // Compute 24-hour total sleep vs multi-day average sleep for the Sleep Duration card
  const sleepDisplayStats = useMemo(() => {
    const daySleepMap = new Map<string, number>();

    filteredEntries.forEach((e) => {
      const v = parseMeasurement(e.record, "sleepDuration");
      if (v === null) return;

      let dayKey = "";
      if (e.record.assessmentDate) {
        dayKey = e.record.assessmentDate.slice(0, 10);
      } else if (e.timestamp) {
        const dt = new Date(e.timestamp);
        dayKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      }
      if (dayKey) {
        daySleepMap.set(dayKey, (daySleepMap.get(dayKey) || 0) + v);
      }
    });

    // 24h total
    let total24h = 0;
    if (latestAnalysis?.today_submissions_breakdown?.sleep?.total_today !== undefined) {
      total24h = Number(latestAnalysis.today_submissions_breakdown.sleep.total_today);
    } else {
      filteredEntries.forEach((e) => {
        const v = parseMeasurement(e.record, "sleepDuration");
        if (v !== null) total24h += v;
      });
    }

    // Multi-day average
    const dayTotals = Array.from(daySleepMap.values());
    let avgMultiDay = 0;
    if (dayTotals.length > 0) {
      avgMultiDay = Math.round((dayTotals.reduce((a, b) => a + b, 0) / dayTotals.length) * 10) / 10;
    } else if (total24h > 0) {
      avgMultiDay = Math.round(total24h * 10) / 10;
    }

    return {
      total24h: Math.round(total24h * 10) / 10,
      avgMultiDay,
    };
  }, [filteredEntries, latestAnalysis]);

  /**
   * Collapse filteredEntries into one row PER CALENDAR DAY for the history table.
   * - sleep, water, exercise → sum all same-day session_increments (from record fields)
   * - vitals (HR, SpO2, BP, temp) → use the latest reading of the day
   * - Each unique calendar day becomes exactly ONE row
   */
  const dailyTableEntries = useMemo(() => {
    type DayBucket = {
      dayKey: string;
      dateLabel: string;
      latestEntry: (typeof filteredEntries)[0];
      sleep: number;
      water: number;
      exercise: number;
      hr: string;
      bp: string;
      ox: string;
      temp: string;
      observations: string;
    };
    const dayMap = new Map<string, DayBucket>();

    for (const entry of filteredEntries) {
      const dayKey =
        entry.timestamp ? new Date(entry.timestamp).toISOString().slice(0, 10) : entry.dateLabel;

      const s = parseFloat(entry.record.sleepDuration || "0") || 0;
      const w = parseFloat(entry.record.waterIntake || "0") || 0;
      const e = parseFloat(entry.record.exerciseDuration || "0") || 0;

      if (dayMap.has(dayKey)) {
        const b = dayMap.get(dayKey)!;
        b.sleep = Math.round((b.sleep + s) * 100) / 100;
        b.water = Math.round((b.water + w) * 100) / 100;
        b.exercise = Math.round((b.exercise + e) * 10) / 10;
        // Keep latest vitals reading for the day
        if (entry.record.heartRate?.trim()) b.hr = entry.record.heartRate;
        if (entry.record.systolic?.trim() && entry.record.diastolic?.trim())
          b.bp = `${entry.record.systolic}/${entry.record.diastolic}`;
        if (entry.record.oxygenSaturation?.trim()) b.ox = entry.record.oxygenSaturation;
        if (entry.record.bodyTemperature?.trim()) b.temp = entry.record.bodyTemperature;
        if (entry.record.observations?.trim()) b.observations = entry.record.observations;
        b.latestEntry = entry; // keep latest for inspect panel
      } else {
        dayMap.set(dayKey, {
          dayKey,
          dateLabel: entry.dateLabel,
          latestEntry: entry,
          sleep: s,
          water: w,
          exercise: e,
          hr: entry.record.heartRate || "",
          bp: entry.record.systolic && entry.record.diastolic
            ? `${entry.record.systolic}/${entry.record.diastolic}`
            : "",
          ox: entry.record.oxygenSaturation || "",
          temp: entry.record.bodyTemperature || "",
          observations: entry.record.observations || "",
        });
      }
    }

    // Sort descending (newest day first) for the table
    return Array.from(dayMap.values()).sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }, [filteredEntries]);

  return (
    <main className="content health-trends-page">
      <div className="trends-shell">
        <header className="trends-page-heading">
          <div>
            <p className="trends-eyebrow"><span /> CREW SYSTEMS / HEALTH ANALYTICS</p>
            <h1>Health Trends</h1>
            <p>Assessment history and measurements across selected time periods.</p>
          </div>
          <span className="trends-source">
            <i /> {hasSavedAssessments ? "SAVED ASSESSMENTS" : "AWAITING ASSESSMENTS"}
          </span>
        </header>

        {storageError && <p className="trends-notice" role="status">{storageError}</p>}
        {invalidCount > 0 && (
          <p className="trends-notice" role="status">
            {invalidCount} invalid assessment {invalidCount === 1 ? "record was" : "records were"} skipped.
          </p>
        )}

        {/* ── AI Cross-Period Overview Card ── */}
        {!isLoading && hasSavedAssessments && (
          <section className="trends-ai-overview-card" aria-labelledby="ai-overview-title">
            <div className="ai-overview-header">
              <div className="ai-overview-header-left">
                <span className="trends-section-kicker">00 / AI CLINICAL OVERVIEW</span>
                <h2 id="ai-overview-title">Mission Health Summary</h2>
                <p>Qwen 2.5 7B analysis across 24-hour, 7-day, and 30-day timelines</p>
              </div>
              <div className="ai-overview-header-right">
                {aiOverview ? (
                  <span className="ai-overview-source-badge">🟢 QWEN 2.5 7B — KAGGLE GPU</span>
                ) : (
                  <span className="ai-overview-source-badge ai-overview-source-local">⚡ LOCAL PROTOCOL</span>
                )}
              </div>
            </div>

            {/* Three period mini-cards */}
            <div className="ai-overview-periods-row">
              {(["24h", "7d", "30d"] as const).map((p) => {
                const t = periodTrends[p];
                const dirClass = t?.direction?.includes("improving")
                  ? "improving"
                  : t?.direction?.includes("degrading")
                  ? "degrading"
                  : "stable";
                return (
                  <div key={p} className={`ai-overview-period-chip period-chip-${dirClass}`}>
                    <span className="period-chip-label">
                      {p === "24h" ? "LAST 24 HRS" : p === "7d" ? "LAST 7 DAYS" : "LAST 30 DAYS"}
                    </span>
                    <span className="period-chip-direction">
                      {t?.direction_label || (t?.direction === "insufficient_data" ? "BASELINE" : "—")}
                    </span>
                    {t?.net_improvement_percent !== undefined && t?.net_improvement_percent !== null && (
                      <span className={`period-chip-pct ${t.net_improvement_percent >= 0 ? "pct-pos" : "pct-neg"}`}>
                        {t.net_improvement_percent > 0
                          ? `+${t.net_improvement_percent}%`
                          : `${t.net_improvement_percent}%`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* AI narrative */}
            <div className="ai-overview-narrative">
              {aiOverview ? (
                <p>{aiOverview}</p>
              ) : (
                <>
                  {/* Build a local fallback overview from the 3 period summaries */}
                  {["24h", "7d", "30d"].some((p) => periodTrends[p]?.summary) ? (
                    <p>
                      {["24h", "7d", "30d"]
                        .filter((p) => periodTrends[p]?.summary)
                        .map((p) => periodTrends[p].summary)
                        .join(" ")}
                    </p>
                  ) : (
                    <p className="ai-overview-empty">
                      Submit assessments across multiple days to generate your AI health trajectory overview.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <section className="trends-section" aria-labelledby="trends-overview-title">
          <div className="trends-section-heading">
            <div>
              <span className="trends-section-kicker">01 / CURRENT PERIOD</span>
              <h2 id="trends-overview-title">Health overview</h2>
            </div>
            <div className="trends-range-filter" aria-label="Filter health data by time period">
              {timeRanges.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  className={period === range.id ? "active" : ""}
                  aria-pressed={period === range.id}
                  onClick={() => setPeriod(range.id)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="trends-loading" role="status">
              <span className="trends-loader" /> Loading assessment history…
            </div>
          ) : (
            <div className="trends-metric-grid">
              {latestMetricEntries.map((metric, index) => (
                <article className="trends-metric-card" key={metric.field}>
                  <div className="trends-metric-top">
                    <span className="trends-metric-index">0{index + 1}</span>
                    <span className="trends-metric-glyph" aria-hidden="true">{metric.glyph}</span>
                    <span className="trends-metric-source">{metric.entry ? "LATEST" : "N/A"}</span>
                  </div>
                  <h3>{metric.label}</h3>
                  <p className="trends-metric-value">
                    {metric.entry && metric.entry.record[metric.field]?.trim() ? (
                      <>
                        {metric.entry.record[metric.field].trim()}
                        <small> {metric.unit}</small>
                      </>
                    ) : (
                      "N/A"
                    )}
                  </p>
                  <p className="trends-metric-date">
                    {metric.entry ? metric.entry.dateLabel : "N/A"}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Assessment Analysis */}
        {!isLoading && hasSavedAssessments && (
          <section className="trends-section analysis-panel">
            <div className="trends-section-heading">
              <div>
                <span className="trends-section-kicker">
                  AI / RULE-BASED ASSESSMENT
                </span>
                <h2>Assessment Analysis</h2>
                <p>
                  {latestAnalysisEntry
                    ? `Analysis from ${latestAnalysisEntry.dateLabel}`
                    : "No analysis available for this period"}
                </p>
              </div>
            </div>

            {latestAnalysis ? (
              <div className="analysis-content">
                {/* AI Trajectory & Percent Improvement Evaluation (Driven by Top Period Toggle) */}
                {(() => {
                  const activeTrend =
                    periodTrends[period] ||
                    latestAnalysis.period_trends?.[period] ||
                    (period === "all"
                      ? latestAnalysis.all_time_evaluation
                      : latestAnalysis.trend_evaluation) ||
                    computeClientPeriodTrend(filteredEntries, period);

                  if (!activeTrend) return null;

                  const isAiNarrative = !!activeTrend.ai_narrative;

                  const periodKickers: Record<TimeRange, string> = {
                    "24h": "AI 24-HOUR CLINICAL PROGRESSION (LAST 24 HOURS)",
                    "7d": "AI 7-DAY HEALTH TRAJECTORY (LAST 7 DAYS)",
                    "30d": "AI 30-DAY HEALTH TRAJECTORY (LAST 30 DAYS)",
                    "all": "AI CUMULATIVE MISSION TRAJECTORY (ALL RECORDS)",
                  };

                  const periodTitles: Record<TimeRange, string> = {
                    "24h": "24-Hour Diurnal Progression & Health Drift",
                    "7d": "7-Day Clinical Trajectory & Weekly Adaptation",
                    "30d": "30-Day Physiological Trajectory & Trend",
                    "all": "All-Time Mission Progression from Baseline",
                  };

                  const netPct =
                    activeTrend.net_improvement_percent !== undefined
                      ? activeTrend.net_improvement_percent
                      : activeTrend.improvement_percent;

                  return (
                    <div
                      className={`trends-trajectory-panel trajectory-${
                        activeTrend.direction?.includes("improving")
                          ? "improving"
                          : activeTrend.direction?.includes("degrading")
                          ? "degrading"
                          : "stable"
                      }`}
                    >
                      <div className="trajectory-top-banner">
                        <div>
                          <span className="trends-section-kicker">
                            {periodKickers[period] || "AI PROGRESSION EVALUATION"}
                          </span>
                          <h3 style={{ margin: "4px 0 0", color: "#fff", fontSize: "16px" }}>
                            {periodTitles[period] || "Clinical Trajectory & Improvement Analysis"}
                          </h3>
                        </div>
                        <div className="trajectory-badges-group">
                          {isAiNarrative && (
                            <span
                              style={{
                                fontSize: "10px",
                                fontFamily: "'Intel One Mono', monospace",
                                background: "rgba(0,212,255,0.12)",
                                border: "1px solid rgba(0,212,255,0.4)",
                                borderRadius: "4px",
                                padding: "2px 7px",
                                color: "#38bdf8",
                                letterSpacing: "0.05em",
                                alignSelf: "center",
                              }}
                            >
                              🟢 QWEN 2.5 7B
                            </span>
                          )}
                          {netPct !== undefined && netPct !== null && (
                            <span
                              className={`trajectory-pct-badge ${
                                netPct > 0
                                  ? "pct-positive"
                                  : netPct < 0
                                  ? "pct-negative"
                                  : ""
                              }`}
                            >
                              {netPct > 0
                                ? `+${netPct}% NET IMPROVEMENT`
                                : netPct < 0
                                ? `${netPct}% NET DECLINE`
                                : "0% (STABLE FROM BASELINE)"}
                            </span>
                          )}
                          <span
                            className={`trajectory-direction-badge badge-${
                              activeTrend.direction?.includes("improving")
                                ? "improving"
                                : activeTrend.direction?.includes("degrading")
                                ? "degrading"
                                : activeTrend.direction === "insufficient_data"
                                ? "baseline"
                                : "stable"
                            }`}
                          >
                            {activeTrend.direction_label}
                          </span>
                        </div>
                      </div>

                      <p className="trajectory-summary-narrative">
                        {activeTrend.summary}
                      </p>

                      {period === "24h" && latestAnalysis.today_submissions_breakdown && (
                        <div
                          style={{
                            background: "rgba(6, 20, 36, 0.7)",
                            border: "1px solid rgba(0, 212, 255, 0.25)",
                            borderRadius: "6px",
                            padding: "10px 14px",
                            marginBottom: "16px",
                            fontSize: "12px",
                            color: "#bae6fd",
                            lineHeight: "1.5",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              display: "block",
                              marginBottom: "4px",
                              color: "#38bdf8",
                              fontFamily: "'Intel One Mono', monospace",
                              fontSize: "11px",
                            }}
                          >
                            TODAY'S SUBMISSIONS SENT TO AI ({latestAnalysis.today_submissions_breakdown.submission_count} REPORTS):
                          </span>
                          <div>• <strong>Sleep:</strong> {latestAnalysis.today_submissions_breakdown.sleep.summary_text}</div>
                          <div>• <strong>Water:</strong> {latestAnalysis.today_submissions_breakdown.water.summary_text}</div>
                          <div>• <strong>Exercise:</strong> {latestAnalysis.today_submissions_breakdown.exercise.summary_text}</div>
                        </div>
                      )}

                      {activeTrend.metric_comparisons &&
                        activeTrend.metric_comparisons.length > 0 && (
                          <div className="metric-compare-grid">
                            {activeTrend.metric_comparisons.map((mc: any, idx: number) => {
                              const isSleep =
                                mc.is_sleep ||
                                String(mc.metric || "").toLowerCase().includes("sleep");

                              if (isSleep) {
                                const displayVal =
                                  period === "24h"
                                    ? (mc.total_sleep !== undefined
                                        ? mc.total_sleep
                                        : sleepDisplayStats.total24h || mc.current)
                                    : (mc.average_sleep !== undefined
                                        ? mc.average_sleep
                                        : sleepDisplayStats.avgMultiDay || mc.current);

                                const displaySubtext =
                                  period === "24h" ? "hours total" : "hours/day avg";

                                return (
                                  <div key={idx} className="metric-compare-card">
                                    <div className="metric-compare-top">
                                      <span className="metric-compare-name">{mc.metric}</span>
                                    </div>
                                    <div className="metric-values-row">
                                      <span
                                        className="metric-curr-val"
                                        style={{ fontSize: "1.25rem", fontWeight: 700, color: "#38bdf8" }}
                                      >
                                        {displayVal}{" "}
                                        <small style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 400 }}>
                                          {displaySubtext}
                                        </small>
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div key={idx} className="metric-compare-card">
                                  <div className="metric-compare-top">
                                    <span className="metric-compare-name">{mc.metric}</span>
                                    {mc.trend && mc.trend !== "neutral" && (
                                      <span className={`metric-trend-pill trend-${mc.trend}`}>
                                        {mc.trend.toUpperCase()}
                                      </span>
                                    )}
                                  </div>
                                  <div className="metric-values-row">
                                    <span className="metric-prev-val">
                                      {mc.previous} {mc.unit}
                                    </span>
                                    <span className="metric-arrow">→</span>
                                    <span className="metric-curr-val">
                                      {mc.current} <small>{mc.unit}</small>
                                    </span>
                                    {mc.percent !== null && mc.percent !== undefined && (
                                      <span className={`metric-percent-delta delta-${mc.trend}`}>
                                        {mc.percent > 0 ? `+${mc.percent}%` : `${mc.percent}%`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                    </div>
                  );
                })()}

                {latestAnalysis.medical_alert && (
                  <div
                    className={`trends-alert-box severity-${
                      latestAnalysis.medical_alert.severity || "low"
                    }`}
                  >
                    <strong>
                      {latestAnalysis.medical_alert.seek_medical_support
                        ? "⚠️ FLIGHT SURGEON SUPPORT ADVISED"
                        : "✓ STATUS NOMINAL — NO MEDICAL CONSULTATION REQUIRED"}
                      {latestAnalysis.medical_alert.severity
                        ? ` [${latestAnalysis.medical_alert.severity.toUpperCase()} SEVERITY]`
                        : ""}
                    </strong>
                    {latestAnalysis.medical_alert.advice && (
                      <p>{latestAnalysis.medical_alert.advice}</p>
                    )}
                  </div>
                )}

                {latestAnalysis.exercises && latestAnalysis.exercises.length > 0 && (
                  <div className="analysis-group">
                    <h3>Prescribed Countermeasure Exercises</h3>
                    <ul>
                      {latestAnalysis.exercises.map((ex, index) => (
                        <li key={index}>
                          <strong>{ex.name}</strong> ({ex.duration}): {ex.purpose}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {latestAnalysis.healthcare_suggestions && latestAnalysis.healthcare_suggestions.length > 0 && (
                  <div className="analysis-group">
                    <h3>Healthcare &amp; Preventative Suggestions</h3>
                    <ul>
                      {latestAnalysis.healthcare_suggestions.map((sug, index) => (
                        <li key={index}>{sug}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="analysis-group">
                  <h3>Clinical Insights</h3>
                  {Array.isArray(latestAnalysis.insights) && latestAnalysis.insights.length > 0 ? (
                    <ul>
                      {latestAnalysis.insights.map((insight, index) => (
                        <li key={index}>{insight}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No insights were generated for this assessment.</p>
                  )}
                </div>

                <div className="analysis-group">
                  <h3>Historical Changes</h3>
                  {Array.isArray(latestAnalysis.historical_changes) && latestAnalysis.historical_changes.length > 0 ? (
                    <ul>
                      {latestAnalysis.historical_changes.map((change, index) => {
                        const direction = getChangeDirection(change);

                        return (
                          <li key={index} className={`analysis-change analysis-change-${direction}`}>
                            <span className="analysis-change-indicator" aria-hidden="true">
                              {direction === "increased"
                                ? "↑"
                                : direction === "decreased"
                                ? "↓"
                                : "•"}
                            </span>
                            <span>{change}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p>No historical changes were identified.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="trends-empty-state">
                No saved analysis is available for the assessments in this period.
              </p>
            )}
          </section>
        )}

        <section className="trends-section" aria-labelledby="trends-charts-title">
          <div className="trends-section-heading">
            <div>
              <span className="trends-section-kicker">02 / MEASUREMENT HISTORY</span>
              <h2 id="trends-charts-title">Health trend charts</h2>
              <p>{hasSavedAssessments ? `${filteredEntries.length} saved assessment${filteredEntries.length === 1 ? "" : "s"} in this period` : "0 saved assessments in this period (N/A)"}</p>
            </div>
          </div>
          {isLoading ? (
            <div className="trends-loading" role="status">
              <span className="trends-loader" /> Preparing charts…
            </div>
          ) : (
            <div className="trends-chart-grid">
              {chartDefinitions.map((chart) => (
                <HealthTrendChart
                  key={chart.title}
                  title={chart.title}
                  description={chart.description}
                  unit={chart.unit}
                  data={chartData}
                  series={chart.series}
                />
              ))}
            </div>
          )}
        </section>

        <section className="research-context-panel" aria-labelledby="sleep-research-title">
          <div className="research-context-mark" aria-hidden="true">R</div>
          <div>
            <span className="trends-section-kicker">NASA RESEARCH CONTEXT</span>
            <h2 id="sleep-research-title">Sleep and performance</h2>
            <p>
              The supplied research cites approximately 8 hours of sleep and reports that restriction to 5–6 hours can impair performance within a week.
              This is research context, not a personal threshold or medical recommendation.
            </p>
          </div>
        </section>

        <section className="trends-section history-section" aria-labelledby="health-history-title">
          <div className="trends-section-heading">
            <div>
              <span className="trends-section-kicker">03 / RECORD ARCHIVE</span>
              <h2 id="health-history-title">Health history</h2>
              <p>{hasSavedAssessments ? "Saved in SQLite database" : "No saved records in database (N/A)"}</p>
            </div>
          </div>
          {isLoading ? (
            <div className="trends-loading" role="status">
              <span className="trends-loader" /> Loading records…
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="trends-empty-state">
              No assessments are available in this time period. All values: N/A.
              {hasSavedAssessments && <span> Try a wider date range.</span>}
            </div>
          ) : (
            <div className="trends-history-wrap">
              <table className="trends-history-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Heart rate</th>
                    <th scope="col">Blood pressure</th>
                    <th scope="col">Oxygen</th>
                    <th scope="col">Temp.</th>
                    <th scope="col">Sleep (daily total)</th>
                    <th scope="col">Water (daily total)</th>
                    <th scope="col">Observations</th>
                    <th scope="col"><span className="visually-hidden">Inspect record</span></th>
                  </tr>
                </thead>
                <tbody>
                  {dailyTableEntries.map((day) => (
                    <tr key={day.dayKey}>
                      <td>{day.dateLabel}</td>
                      <td>{day.hr ? `${day.hr} BPM` : "N/A"}</td>
                      <td>{day.bp ? `${day.bp} mmHg` : "N/A"}</td>
                      <td>{day.ox ? `${day.ox} %` : "N/A"}</td>
                      <td>{day.temp ? `${day.temp} °C` : "N/A"}</td>
                      <td>{day.sleep > 0 ? `${day.sleep} h` : "N/A"}</td>
                      <td>{day.water > 0 ? `${day.water} L` : "N/A"}</td>
                      <td className="trends-observation-cell">{day.observations.trim() || "N/A"}</td>
                      <td>
                        <button
                          className="trends-inspect-button"
                          type="button"
                          onClick={() => setInspectedEntry(day.latestEntry)}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="trends-disclaimer">
          Measurements are displayed as recorded and are not diagnoses or medical safety assessments.
        </p>
      </div>

      {inspectedEntry && (
        <div
          className="trends-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInspectedEntry(null);
          }}
        >
          <section className="trends-record-dialog" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
            <div className="trends-dialog-heading">
              <div>
                <span className="trends-section-kicker">
                  SAVED ASSESSMENT
                </span>
                <h2 id="record-dialog-title">Assessment details</h2>
                <p>{inspectedEntry.dateLabel}</p>
              </div>
              <button
                className="trends-dialog-close"
                type="button"
                onClick={() => setInspectedEntry(null)}
                aria-label="Close assessment details"
              >
                ×
              </button>
            </div>
            <dl className="trends-record-details">
              <div><dt>Heart rate</dt><dd>{inspectedEntry.record.heartRate?.trim() ? `${inspectedEntry.record.heartRate} BPM` : "N/A"}</dd></div>
              <div><dt>Blood pressure</dt><dd>{inspectedEntry.record.systolic?.trim() && inspectedEntry.record.diastolic?.trim() ? `${inspectedEntry.record.systolic}/${inspectedEntry.record.diastolic} mmHg` : "N/A"}</dd></div>
              <div><dt>Oxygen saturation</dt><dd>{inspectedEntry.record.oxygenSaturation?.trim() ? `${inspectedEntry.record.oxygenSaturation}%` : "N/A"}</dd></div>
              <div><dt>Body temperature</dt><dd>{inspectedEntry.record.bodyTemperature?.trim() ? `${inspectedEntry.record.bodyTemperature} °C` : "N/A"}</dd></div>
              <div><dt>Sleep duration</dt><dd>{inspectedEntry.record.sleepDuration?.trim() ? `${inspectedEntry.record.sleepDuration} hours` : "N/A"}</dd></div>
              <div><dt>Daily water intake</dt><dd>{inspectedEntry.record.waterIntake?.trim() ? `${inspectedEntry.record.waterIntake} L` : "N/A"}</dd></div>
            </dl>
            <div className="trends-record-observations">
              <span>OBSERVATIONS</span>
              <p>{inspectedEntry.record.observations.trim() || "No observations recorded."}</p>
            </div>

            {/* Assessment Analysis */}
<div className="trends-record-observations">
  <span>ASSESSMENT INSIGHTS</span>

  {inspectedEntry.record.analysis ? (
    Array.isArray(inspectedEntry.record.analysis.insights) && inspectedEntry.record.analysis.insights.length > 0 ? (
      <ul>
        {inspectedEntry.record.analysis.insights.map((insight, index) => (
          <li key={index}>{insight}</li>
        ))}
      </ul>
    ) : (
      <p>No insights were generated.</p>
    )
  ) : (
    <p>No analysis available for this assessment.</p>
  )}
</div>

<div className="trends-record-observations">
  <span>HISTORICAL CHANGES</span>

  {inspectedEntry.record.analysis ? (
    Array.isArray(inspectedEntry.record.analysis.historical_changes) && inspectedEntry.record.analysis.historical_changes.length > 0 ? (
      <ul>
        
{inspectedEntry.record.analysis.historical_changes.map((change, index) => {
  const direction = getChangeDirection(change);

  return (
    <li key={index} className={`analysis-change analysis-change-${direction}`}>
      <span className="analysis-change-indicator" aria-hidden="true">
        {direction === "increased"
          ? "↑"
          : direction === "decreased"
          ? "↓"
          : "•"}
      </span>
      <span>{change}</span>
    </li>
  );
})}

      </ul>
    ) : (
      <p>No historical changes identified.</p>
    )
  ) : (
    <p>No analysis available for this assessment.</p>
  )}
</div>

          </section>
        </div>
      )}
    </main>
  );
}
