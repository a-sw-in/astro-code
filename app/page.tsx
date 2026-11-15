import { Suspense } from "react";
import OverviewDashboard from "./components/overview-dashboard";
import "./overview.css";

export default function Home() {
  return (
    <Suspense fallback={<div className="content">Loading astronaut telemetry...</div>}>
      <OverviewDashboard />
    </Suspense>
  );
}
