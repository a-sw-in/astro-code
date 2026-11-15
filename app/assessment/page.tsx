import { Suspense } from "react";
import HealthAssessmentForm from "../components/health-assessment-form";
import "./assessment.css";

export default function AssessmentPage() {
  return (
    <Suspense fallback={<div className="content">Loading astronaut health assessment...</div>}>
      <HealthAssessmentForm />
    </Suspense>
  );
}
