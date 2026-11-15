import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "ASTRO CODE BLUE | Ground Control Admin Panel",
  description: "Ground operations telemetry and tele-triage dashboard",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-scope">{children}</div>;
}
