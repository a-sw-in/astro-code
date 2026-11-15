import { Suspense } from "react";
import HealthGuidance from "../components/health-guidance";
import "../guidance.css";

export default function GuidancePage() {
  return (
    <Suspense fallback={<div className="content">Loading flight surgeon guidance...</div>}>
      <HealthGuidance />
    </Suspense>
  );
}
