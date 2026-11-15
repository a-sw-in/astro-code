/**
 * ASTRO CODE BLUE — Core Configuration & Environment Bindings
 * Centralized resolution of Kaggle AI, FastAPI Backend, and Ground Support URLs.
 */

export const BACKEND_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export const KAGGLE_AI_URL = (
  process.env.NEXT_PUBLIC_KAGGLE_AI_URL ||
  process.env.KAGGLE_AI_URL ||
  "https://optical-art-plot-nascar.trycloudflare.com"
).replace(/\/+$/, "");

export const DUMMY_SUPPORT_LINK = (
  process.env.NEXT_PUBLIC_DUMMY_SUPPORT_LINK ||
  process.env.DUMMY_SUPPORT_LINK ||
  "https://www.google.com"
).trim();
