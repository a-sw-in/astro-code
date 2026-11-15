import { NextResponse } from "next/server";
import { getKaggleUrl, setKaggleUrl } from "@/app/lib/support-db";
import { BACKEND_URL } from "@/app/lib/config";

async function probeKaggleUrl(rawUrl: string): Promise<{ isOnline: boolean; error: string | null }> {
  const url = rawUrl.trim().replace(/\/+$/, "");
  if (!url) return { isOnline: false, error: "No URL configured" };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    // Try a fast probe
    const res = await fetch(`${url}/docs`, {
      method: "GET",
      signal: controller.signal,
    }).catch(async () => {
      return await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
    });

    clearTimeout(timeoutId);

    // If we received any HTTP response from Cloudflare/FastAPI, the tunnel is up!
    if (res && res.status < 502) {
      return { isOnline: true, error: null };
    }
    return { isOnline: false, error: `Endpoint returned HTTP ${res?.status || "unavailable"}` };
  } catch (err: any) {
    return {
      isOnline: false,
      error: err?.name === "AbortError" ? "Connection timed out (3.5s)" : "Cloudflare tunnel offline or host unreachable",
    };
  }
}

export async function GET() {
  const url = getKaggleUrl();
  const { isOnline, error } = await probeKaggleUrl(url);

  return NextResponse.json({
    url,
    isConfigured: Boolean(url),
    isOnline,
    error,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = (body.url || "").trim();
    setKaggleUrl(url);

    // Sync to Python FastAPI backend if running
    try {
      fetch(`${BACKEND_URL}/api/set-kaggle-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    } catch {}

    const { isOnline, error } = await probeKaggleUrl(url);

    return NextResponse.json({
      message: url ? `Kaggle AI URL set to ${url}` : "Kaggle AI URL cleared",
      url,
      isConfigured: Boolean(url),
      isOnline,
      error,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to set Kaggle URL" }, { status: 500 });
  }
}
