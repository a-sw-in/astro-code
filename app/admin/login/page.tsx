"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push("/admin/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Invalid credentials");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.badge}>⬡ ASTRO CODE BLUE</div>
          <h1 style={styles.title}>GROUND CONTROL</h1>
          <p style={styles.subtitle}>ADMIN PANEL ACCESS</p>
          <div style={styles.divider} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>OPERATOR ID</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter operator ID"
              required
              autoComplete="username"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>ACCESS CODE</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter access code"
              required
              autoComplete="current-password"
              style={styles.input}
            />
          </div>

          {error && <div style={styles.error}>⚠ {error}</div>}

          <button
            type="submit"
            disabled={loading}
            style={loading ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
          >
            {loading ? "AUTHENTICATING..." : "ACCESS GROUND CONTROL"}
          </button>
        </form>

        <p style={styles.footer}>ASTRO CODE BLUE — MISSION CONTROL v1.0</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#000000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Inter', sans-serif",
    padding: "20px",
  },
  card: {
    background: "#090d13",
    border: "1px solid #1b2633",
    borderRadius: "12px",
    padding: "48px 40px",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 0 60px rgba(22, 139, 255, 0.08)",
  },
  header: {
    textAlign: "center",
    marginBottom: "36px",
  },
  badge: {
    display: "inline-block",
    background: "rgba(22,139,255,0.1)",
    border: "1px solid rgba(22,139,255,0.3)",
    color: "#168bff",
    borderRadius: "20px",
    padding: "4px 14px",
    fontSize: "11px",
    letterSpacing: "2px",
    marginBottom: "16px",
    fontFamily: "'Intel One Mono', monospace",
  },
  title: {
    color: "#ffffff",
    fontSize: "28px",
    letterSpacing: "4px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 900,
    margin: "0 0 6px 0",
  },
  subtitle: {
    color: "#8994a3",
    fontSize: "11px",
    letterSpacing: "3px",
    fontFamily: "'Intel One Mono', monospace",
    margin: 0,
  },
  divider: {
    width: "60px",
    height: "2px",
    background: "linear-gradient(90deg, transparent, #168bff, transparent)",
    margin: "20px auto 0",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  label: {
    color: "#8994a3",
    fontSize: "11px",
    letterSpacing: "2px",
    fontFamily: "'Intel One Mono', monospace",
  },
  input: {
    background: "#0d1520",
    border: "1px solid #1b2633",
    borderRadius: "6px",
    padding: "12px 16px",
    color: "#ffffff",
    fontSize: "14px",
    fontFamily: "'Intel One Mono', monospace",
    outline: "none",
    transition: "border-color 0.2s",
  },
  error: {
    background: "rgba(255, 60, 60, 0.1)",
    border: "1px solid rgba(255, 60, 60, 0.3)",
    color: "#ff6b6b",
    borderRadius: "6px",
    padding: "10px 14px",
    fontSize: "13px",
    fontFamily: "'Intel One Mono', monospace",
  },
  button: {
    background: "linear-gradient(135deg, #168bff, #0066cc)",
    border: "none",
    borderRadius: "6px",
    padding: "14px",
    color: "#ffffff",
    fontSize: "12px",
    letterSpacing: "2px",
    fontFamily: "'Intel One Mono', monospace",
    fontWeight: 700,
    cursor: "pointer",
    marginTop: "8px",
    transition: "opacity 0.2s",
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  footer: {
    textAlign: "center",
    color: "#3a4a5c",
    fontSize: "10px",
    letterSpacing: "2px",
    fontFamily: "'Intel One Mono', monospace",
    marginTop: "32px",
  },
};
