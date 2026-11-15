"use client";

import { useCallback, useEffect, useState } from "react";

type ServiceStatus = "checking" | "online" | "offline";

interface SystemState {
  kaggle: ServiceStatus;
  kaggleUrl: string;
  backend: ServiceStatus;
  backendUrl: string;
  database: ServiceStatus;
  databasePath: string;
  lastChecked: string | null;
}

function pill(status: ServiceStatus) {
  if (status === "checking") return { icon: "⏳", label: "CHECKING", cls: "sys-pill--checking" };
  if (status === "online") return { icon: "🟢", label: "ONLINE", cls: "sys-pill--online" };
  return { icon: "🔴", label: "OFFLINE", cls: "sys-pill--offline" };
}

export default function OnlineSystemsDashboard() {
  const [state, setState] = useState<SystemState>({
    kaggle: "checking",
    kaggleUrl: "",
    backend: "checking",
    backendUrl: "",
    database: "checking",
    databasePath: "",
    lastChecked: null,
  });

  const check = useCallback(async () => {
    setState((s) => ({
      ...s,
      kaggle: "checking",
      backend: "checking",
      database: "checking",
    }));

    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setState({
        kaggle: data.kaggle?.isOnline ? "online" : "offline",
        kaggleUrl: data.kaggle?.url ?? "",
        backend: data.backend?.isOnline ? "online" : "offline",
        backendUrl: data.backend?.url ?? "",
        database: data.database?.exists ? "online" : "offline",
        databasePath: data.database?.path ?? "",
        lastChecked: new Date().toLocaleTimeString(),
      });
    } catch {
      setState((s) => ({
        ...s,
        kaggle: "offline",
        backend: "offline",
        database: "offline",
        lastChecked: new Date().toLocaleTimeString(),
      }));
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  const isChecking =
    state.kaggle === "checking" ||
    state.backend === "checking" ||
    state.database === "checking";

  const allOnline =
    state.kaggle === "online" &&
    state.backend === "online" &&
    state.database === "online";

  const kaggle = pill(state.kaggle);
  const backend = pill(state.backend);
  const database = pill(state.database);

  return (
    <main className="content sys-page">
      {/* ── Page Header ── */}
      <div className="sys-header">
        <div className="sys-header-title">
          <span className="sys-orbit-mark" aria-hidden="true">✦</span>
          <div>
            <p className="sys-eyebrow">ASTRO CODE BLUE / SYSTEM HEALTH</p>
            <h1>ONLINE SYSTEMS</h1>
            <p className="sys-subtitle">
              Live status of all connected services — AI model, backend server, and database.
            </p>
          </div>
        </div>

        <div className="sys-header-actions">
          <div className={`sys-overall-badge ${allOnline ? "is-all-online" : isChecking ? "is-checking" : "is-degraded"}`}>
            <span aria-hidden="true">
              {isChecking ? "⏳" : allOnline ? "🟢" : "⚠️"}
            </span>
            <span>
              {isChecking ? "CHECKING SYSTEMS…" : allOnline ? "ALL SYSTEMS NOMINAL" : "SYSTEMS DEGRADED"}
            </span>
          </div>

          <button
            type="button"
            className="sys-refresh-btn"
            onClick={check}
            disabled={isChecking}
            aria-label="Refresh system status"
          >
            <span aria-hidden="true">↻</span> REFRESH
          </button>

          {state.lastChecked && (
            <p className="sys-last-checked">Last checked: {state.lastChecked}</p>
          )}
        </div>
      </div>

      {/* ── Service Cards ── */}
      <div className="sys-grid">

        {/* Kaggle AI */}
        <div className={`sys-card ${state.kaggle === "online" ? "is-online" : state.kaggle === "offline" ? "is-offline" : "is-checking"}`}>
          <div className="sys-card-top">
            <div className="sys-card-icon">🤖</div>
            <div className={`sys-pill ${kaggle.cls}`}>
              <span>{kaggle.icon}</span> {kaggle.label}
            </div>
          </div>
          <h2 className="sys-card-name">KAGGLE AI</h2>
          <p className="sys-card-desc">Qwen 2.5 7B Instruct · GPU Model · Cloudflare Tunnel</p>
          <div className="sys-card-url">{state.kaggleUrl || "—"}</div>
          <div className="sys-card-hint">
            {state.kaggle === "online"
              ? "AI model is reachable and accepting requests."
              : state.kaggle === "offline"
              ? "Tunnel is down. Start the Kaggle notebook and copy the new Cloudflare URL to .env → KAGGLE_AI_URL."
              : "Probing tunnel endpoint…"}
          </div>
        </div>

        {/* FastAPI Backend */}
        <div className={`sys-card ${state.backend === "online" ? "is-online" : state.backend === "offline" ? "is-offline" : "is-checking"}`}>
          <div className="sys-card-top">
            <div className="sys-card-icon">⚙️</div>
            <div className={`sys-pill ${backend.cls}`}>
              <span>{backend.icon}</span> {backend.label}
            </div>
          </div>
          <h2 className="sys-card-name">FASTAPI BACKEND</h2>
          <p className="sys-card-desc">Python · Uvicorn · Local Server · Port 8000</p>
          <div className="sys-card-url">{state.backendUrl || "—"}</div>
          <div className="sys-card-hint">
            {state.backend === "online"
              ? "Backend is running and connected."
              : state.backend === "offline"
              ? <>Run: <code>cd backend &amp;&amp; python -m uvicorn main:app --reload --port 8000</code></>
              : "Connecting to backend…"}
          </div>
        </div>

        {/* Database */}
        <div className={`sys-card ${state.database === "online" ? "is-online" : state.database === "offline" ? "is-offline" : "is-checking"}`}>
          <div className="sys-card-top">
            <div className="sys-card-icon">🗄️</div>
            <div className={`sys-pill ${database.cls}`}>
              <span>{database.icon}</span> {database.label}
            </div>
          </div>
          <h2 className="sys-card-name">DATABASE</h2>
          <p className="sys-card-desc">SQLite · astro_code_blue.db · Health Records Store</p>
          <div className="sys-card-url" title={state.databasePath}>
            {state.databasePath ? state.databasePath.split(/[\\/]/).slice(-3).join(" / ") : "—"}
          </div>
          <div className="sys-card-hint">
            {state.database === "online"
              ? "Database file found. Health records are being persisted."
              : state.database === "offline"
              ? "DB file not found. Submit at least one health assessment to create it."
              : "Locating database file…"}
          </div>
        </div>

      </div>

      {/* ── Info strip ── */}
      <div className="sys-info-strip">
        <span className="sys-info-kicker">ℹ AUTO-REFRESH</span>
        <span>Status is polled every 30 seconds automatically. Click REFRESH to check immediately.</span>
      </div>
    </main>
  );
}
