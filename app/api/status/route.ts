import { NextResponse } from "next/server";
import { KAGGLE_AI_URL, BACKEND_URL } from "@/app/lib/config";
import path from "node:path";
import fs from "node:fs";

async function probeUrl(url: string, timeoutMs = 8000): Promise<boolean> {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${trimmed}/docs`, {
      method: "GET",
      signal: controller.signal,
    }).catch(() =>
      fetch(trimmed, { method: "GET", signal: controller.signal })
    );
    clearTimeout(id);
    return Boolean(res && res.status < 502);
  } catch {
    return false;
  }
}

export async function GET() {
  const DB_PATH = path.join(process.cwd(), "backend", "astro_code_blue.db");

  const [kaggleOnline, backendOnline] = await Promise.all([
    probeUrl(KAGGLE_AI_URL),
    probeUrl(BACKEND_URL),
  ]);

  const dbExists = fs.existsSync(DB_PATH);

  return NextResponse.json({
    kaggle: {
      url: KAGGLE_AI_URL,
      isOnline: kaggleOnline,
    },
    backend: {
      url: BACKEND_URL,
      isOnline: backendOnline,
    },
    database: {
      path: DB_PATH,
      exists: dbExists,
    },
  });
}
