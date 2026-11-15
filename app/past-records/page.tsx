import { Suspense } from "react";
import PastRecordsDashboard from "../components/past-records-dashboard";
import "./past-records.css";

export const metadata = {
  title: "Past Health Records | ASTRO CODE BLUE",
  description: "Historical mission telemetry archives, multi-session clinical breakdowns, and AI flight surgeon records by date.",
};

export default function PastRecordsPage() {
  return (
    <Suspense fallback={<div className="content">Loading past records...</div>}>
      <PastRecordsDashboard />
    </Suspense>
  );
}
