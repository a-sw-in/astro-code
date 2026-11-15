import { NextResponse } from "next/server";
import { KAGGLE_AI_URL, BACKEND_URL } from "@/app/lib/config";

async function probeKaggleUrl(rawUrl: string): Promise<{ isOnline: boolean; error: string | null }> {
  const url = rawUrl.trim().replace(/\/+$/, "");
  if (!url) return { isOnline: false, error: "No URL configured" };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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

// GET — always reads Kaggle URL from env (KAGGLE_AI_URL / NEXT_PUBLIC_KAGGLE_AI_URL)
export async function GET() {
  const url = KAGGLE_AI_URL;
  const { isOnline, error } = await probeKaggleUrl(url);

  return NextResponse.json({
    url,
    isConfigured: Boolean(url),
    isOnline,
    error,
  });
}

// POST kept for backward compat but syncs to FastAPI only; URL is env-driven
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = (body.url || KAGGLE_AI_URL).trim();

    try {
      fetch(`${BACKEND_URL}/api/set-kaggle-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    } catch {}

    const { isOnline, error } = await probeKaggleUrl(url);

    return NextResponse.json({
      message: `Kaggle AI URL: ${url}`,
      url,
      isConfigured: Boolean(url),
      isOnline,
      error,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed" }, { status: 500 });
  }
}
