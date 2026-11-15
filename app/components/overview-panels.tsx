import Link from "next/link";
import type { AssessmentRecord } from "../data/health-data";

export type HealthReading = {
  id:
    | "heartRate"
    | "bloodPressure"
    | "oxygenSaturation"
    | "bodyTemperature"
    | "hydration"
    | "sleep"
    | "exercise";
  label: string;
  value: string;
  unit: string;
  glyph: string;
  breakdown?: string;
};

export function MissionBackground() {
  return <div className="space-backdrop" aria-hidden="true" />;
}

export function HealthLevel({ readings }: { readings: HealthReading[] }) {
  return (
    <div className="health-readings">
      {readings.map((reading, index) => (
        <div className="health-reading" key={reading.id}>
          <span className="health-reading-index">0{index + 1}</span>
          <span className="health-reading-glyph" aria-hidden="true">{reading.glyph}</span>
          <span className="health-reading-copy">
            <span className="health-reading-name">{reading.label}</span>
            <strong>
              {reading.value}
              {reading.value !== "—" && reading.value !== "N/A" && reading.value !== "No data" && <small> {reading.unit}</small>}
            </strong>
            {reading.breakdown && (
              <span
                style={{
                  display: "block",
                  fontSize: "10px",
                  color: "#38bdf8",
                  fontFamily: "'Intel One Mono', monospace",
                  marginTop: "3px",
                  lineHeight: 1.3,
                  opacity: 0.9,
                }}
              >
                {reading.breakdown}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SleepChart({ records }: { records: AssessmentRecord[] }) {
  // Aggregate sleep duration by calendar day across multiple daily logs
  const dayMap = new Map<string, { day: string; hours: number }>();

  for (const record of records) {
    const rawVal = parseFloat(record.sleepDuration.trim());
    if (!Number.isFinite(rawVal) || rawVal <= 0) continue;

    const rawDate = record.assessmentDate || record.submittedAt;
    try {
      const dt = new Date(rawDate);
      const dayKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short" })
        .format(dt)
        .toUpperCase();

      const sleepHours = record.analysis?.daily_aggregates?.total_sleep ?? rawVal;
      const existing = dayMap.get(dayKey);
      if (existing) {
        if (record.analysis?.daily_aggregates?.total_sleep) {
          existing.hours = Math.max(existing.hours, record.analysis.daily_aggregates.total_sleep);
        } else {
          existing.hours = Math.round((existing.hours + rawVal) * 10) / 10;
        }
      } else {
        dayMap.set(dayKey, { day: dayLabel, hours: sleepHours });
      }
    } catch {}
  }

  const actualSleep = Array.from(dayMap.values()).slice(-7);

  if (actualSleep.length === 0) {
    return (
      <div className="sleep-chart sleep-chart-empty" role="img" aria-label="No sleep assessment data recorded in database">
        <div className="overview-empty-chart-content">
          <span className="empty-chart-glyph">◷</span>
          <p className="empty-chart-title">NO DATA FOUND IN DB</p>
          <span className="empty-chart-sub">Log sleep duration to calculate weekly trends</span>
          <Link href="/assessment?section=sleepAndWellness" className="overview-redirect-btn">
            + Log Sleep &amp; Wellness →
          </Link>
        </div>
      </div>
    );
  }

  const chartData = actualSleep;
  const maxHours = Math.max(...chartData.map((item) => item.hours), 1);
  const chartDescription = `Sleep duration values from ${actualSleep.length} saved assessments`;

  return (
    <div className="sleep-chart" role="img" aria-label={chartDescription}>
      <div className="chart-y-labels" aria-hidden="true">
        <span>8h</span><span>6h</span><span>4h</span><span>2h</span><span>0</span>
      </div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <div className="sleep-bars">
          {chartData.map((item, index) => (
            <div className="sleep-bar-column" key={`${item.day}-${index}`}>
              <span className="sleep-bar-value">{item.hours.toFixed(1)}</span>
              <span
                className="sleep-bar"
                style={{ height: `${Math.max((item.hours / maxHours) * 100, 4)}%` }}
              />
              <span className="sleep-bar-day">{item.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type HealthTrendField =
  | "heartRate"
  | "oxygenSaturation"
  | "bodyTemperature"
  | "waterIntake"
  | "bloodPressure";

type HealthTrendPoint = {
  value: number;
  secondaryValue?: number;
  date: string;
};

export function HealthTrendCard({
  records,
  field,
  label,
  unit,
  color,
  sectionId = "vitalSigns",
  redirectLabel,
}: {
  records: AssessmentRecord[];
  field: HealthTrendField;
  label: string;
  unit: string;
  color: string;
  sectionId?: string;
  redirectLabel?: string;
}) {
  const savedPoints = records.flatMap<HealthTrendPoint>((record) => {
    if (field === "bloodPressure") {
      const systolic = record.systolic.trim();
      const diastolic = record.diastolic.trim();
      if (!systolic || !diastolic) return [];
      const primary = Number(systolic);
      const secondary = Number(diastolic);
      if (!Number.isFinite(primary) || !Number.isFinite(secondary)) return [];
      return [{ value: primary, secondaryValue: secondary, date: record.submittedAt }];
    }

    const rawValue = record[field].trim();
    if (!rawValue) return [];
    const value = Number(rawValue);
    return Number.isFinite(value) ? [{ value, date: record.submittedAt }] : [];
  });

  const hasSavedTrend = savedPoints.length > 0;
  const actionText = redirectLabel || `+ Record ${label}`;

  if (field === "oxygenSaturation") {
    if (!hasSavedTrend) {
      return (
        <article className="glass-panel health-trend-card is-empty">
          <div className="health-trend-heading">
            <div>
              <h3>{label}</h3>
              <span className="status-no-data">N/A</span>
            </div>
            <strong>N/A</strong>
          </div>
          <div className="overview-empty-chart-wrap">
            <span className="empty-chart-glyph">◉</span>
            <p className="empty-chart-note">No oxygen records in database (N/A)</p>
            <Link href={`/assessment?section=${sectionId}`} className="overview-redirect-btn">
              {actionText} →
            </Link>
          </div>
          <div className="health-trend-axis">
            <span>N/A</span>
            <span>AWAITING ENTRY</span>
          </div>
        </article>
      );
    }

    const latestSavedPoint = savedPoints[savedPoints.length - 1];
    const oxygenValue = latestSavedPoint.value;
    const chartable = oxygenValue >= 0 && oxygenValue <= 100;
    const endAngle = (oxygenValue / 100) * Math.PI * 2 - Math.PI / 2;
    const endX = 50 + 42 * Math.cos(endAngle);
    const endY = 50 + 42 * Math.sin(endAngle);
    const largeArc = oxygenValue > 50 ? 1 : 0;
    const slicePath = `M 50 50 L 50 8 A 42 42 0 ${largeArc} 1 ${endX} ${endY} Z`;

    return (
      <article className="glass-panel health-trend-card">
        <div className="health-trend-heading">
          <div>
            <h3>{label}</h3>
            <span>{savedPoints.length > 1 ? "ASSESSMENT HISTORY" : "LATEST ASSESSMENT"}</span>
          </div>
          <div className="health-trend-value-group">
            <strong>{oxygenValue}<small> {unit}</small></strong>
            <Link href={`/assessment?section=${sectionId}`} className="overview-mini-add-btn" title="Add assessment reading">
              + Log
            </Link>
          </div>
        </div>
        <div className="oxygen-pie-wrap">
          <svg
            className="oxygen-pie-chart"
            viewBox="0 0 100 100"
            role="img"
            aria-label={`Saved oxygen saturation value: ${oxygenValue} percent`}
          >
            <circle cx="50" cy="50" r="42" fill="#263544" />
            {chartable && oxygenValue >= 100 ? (
              <circle cx="50" cy="50" r="42" fill={color} />
            ) : chartable && oxygenValue > 0 ? (
              <path d={slicePath} fill={color} />
            ) : null}
          </svg>
        </div>
        <div className="health-trend-axis">
          <span>{new Date(latestSavedPoint.date).toLocaleDateString()}</span>
          <span>{chartable ? "VALUE SHARE" : "OUTSIDE PIE SCALE"}</span>
        </div>
      </article>
    );
  }

  if (field === "waterIntake") {
    if (!hasSavedTrend) {
      return (
        <article className="glass-panel health-trend-card is-empty">
          <div className="health-trend-heading">
            <div>
              <h3>{label}</h3>
              <span className="status-no-data">N/A</span>
            </div>
            <strong>N/A</strong>
          </div>
          <div className="overview-empty-chart-wrap">
            <span className="empty-chart-glyph">◌</span>
            <p className="empty-chart-note">No hydration records in database (N/A)</p>
            <Link href={`/assessment?section=${sectionId}`} className="overview-redirect-btn">
              {actionText} →
            </Link>
          </div>
          <div className="health-trend-axis">
            <span>N/A</span>
            <span>AWAITING ENTRY</span>
          </div>
        </article>
      );
    }

    const latestSavedPoint = savedPoints[savedPoints.length - 1];
    const waterValue = latestSavedPoint.value;

    return (
      <article className="glass-panel health-trend-card">
        <div className="health-trend-heading">
          <div>
            <h3>{label}</h3>
            <span>{savedPoints.length > 1 ? "ASSESSMENT HISTORY" : "LATEST ASSESSMENT"}</span>
          </div>
          <div className="health-trend-value-group">
            <strong>{waterValue}<small> {unit}</small></strong>
            <Link href={`/assessment?section=${sectionId}`} className="overview-mini-add-btn" title="Add assessment reading">
              + Log
            </Link>
          </div>
        </div>
        <div className="hydration-drop-wrap">
          <svg
            className="hydration-drop"
            viewBox="0 0 100 120"
            role="img"
            aria-label={`Saved daily water intake: ${waterValue} ${unit}`}
          >
            <defs>
              <linearGradient id="hydration-drop-fill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00d4ff" />
                <stop offset="100%" stopColor="#168bff" />
              </linearGradient>
            </defs>
            <path
              className="hydration-drop-shadow"
              d="M50 5C39 24 15 48 15 72a35 35 0 0 0 70 0C85 48 61 24 50 5Z"
            />
            <path
              className="hydration-drop-shape"
              d="M50 5C39 24 15 48 15 72a35 35 0 0 0 70 0C85 48 61 24 50 5Z"
              fill="url(#hydration-drop-fill)"
            />
            <path
              className="hydration-drop-highlight"
              d="M39 42c-8 11-12 21-12 30"
            />
          </svg>
          <span className="hydration-drop-value" aria-hidden="true">
            {waterValue}<small> {unit}</small>
          </span>
        </div>
        <div className="health-trend-axis">
          <span>{new Date(latestSavedPoint.date).toLocaleDateString()}</span>
          <span>RECORDED DAILY WATER INTAKE</span>
        </div>
      </article>
    );
  }

  if (!hasSavedTrend) {
    return (
      <article className="glass-panel health-trend-card is-empty">
        <div className="health-trend-heading">
          <div>
            <h3>{label}</h3>
            <span className="status-no-data">N/A</span>
          </div>
          <strong>N/A</strong>
        </div>
        <div className="overview-empty-chart-wrap">
          <span className="empty-chart-glyph">⌁</span>
          <p className="empty-chart-note">No {label.toLowerCase()} records in database (N/A)</p>
          <Link href={`/assessment?section=${sectionId}`} className="overview-redirect-btn">
            {actionText} →
          </Link>
        </div>
        <div className="health-trend-axis">
          <span>N/A</span>
          <span>AWAITING ENTRY</span>
        </div>
      </article>
    );
  }

  const points: HealthTrendPoint[] = savedPoints.slice(-8);
  const values = points.map((point) => point.value);
  const secondaryValues = points.flatMap((point) =>
    point.secondaryValue === undefined ? [] : [point.secondaryValue],
  );
  const allValues = [...values, ...secondaryValues];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? 50 : 8 + (index / (points.length - 1)) * 84,
    y: 58 - ((point.value - min) / range) * 38,
    secondaryY: point.secondaryValue === undefined
      ? undefined
      : 58 - ((point.secondaryValue - min) / range) * 38,
    ...point,
  }));
  const path = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const secondaryPath = coordinates
    .filter((point) => point.secondaryY !== undefined)
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.secondaryY}`)
    .join(" ");
  const latestPoint = points[points.length - 1];

  return (
    <article className="glass-panel health-trend-card">
      <div className="health-trend-heading">
        <div>
          <h3>{label}</h3>
          <span>
            {savedPoints.length > 1
              ? "ASSESSMENT HISTORY"
              : "LATEST ASSESSMENT"}
          </span>
        </div>
        <div className="health-trend-value-group">
          <strong>
            {field === "bloodPressure" && "secondaryValue" in latestPoint
              ? `${latestPoint.value}/${latestPoint.secondaryValue}`
              : latestPoint.value}
            <small> {unit}</small>
          </strong>
          <Link href={`/assessment?section=${sectionId}`} className="overview-mini-add-btn" title="Add assessment reading">
            + Log
          </Link>
        </div>
      </div>
      <svg
        className="health-trend-chart"
        viewBox="0 0 100 72"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Saved assessment ${label.toLowerCase()} trend`}
      >
        {[20, 39, 58].map((y) => (
          <line
            key={y}
            className="health-trend-gridline"
            x1="5"
            x2="95"
            y1={y}
            y2={y}
          />
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke="#8ba9ff"
            strokeWidth="1.3"
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {coordinates.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle cx={point.x} cy={point.y} r="1.7" fill={color} />
            {point.secondaryY !== undefined && (
              <circle cx={point.x} cy={point.secondaryY} r="1.5" fill="#8ba9ff" />
            )}
          </g>
        ))}
      </svg>
      <div className="health-trend-axis">
        <span>{new Date(points[0].date).toLocaleDateString()}</span>
        <span>{new Date(points[points.length - 1].date).toLocaleDateString()}</span>
      </div>
      {field === "bloodPressure" && (
        <div className="blood-pressure-legend">
          <span><i /> SYSTOLIC</span><span><i /> DIASTOLIC</span>
        </div>
      )}
    </article>
  );
}
