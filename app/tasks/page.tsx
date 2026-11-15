import { Suspense } from "react";
import MissionTasksDashboard from "../components/mission-tasks-dashboard";
import "./tasks.css";

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="content">Loading clinical tasks...</div>}>
      <MissionTasksDashboard />
    </Suspense>
  );
}
