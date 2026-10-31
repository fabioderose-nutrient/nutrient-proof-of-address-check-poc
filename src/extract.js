// Calls the Nutrient Data Extraction API extract endpoint (POST /extraction/extract).
// The API key stays on the server: the browser never sees it.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { extractionInstructions, extractionSchema } from "./schema.js";

const API_URL = (process.env.NUTRIENT_API_URL || "https://api.nutrient.io").replace(/\/+$/, "");

// Parse modes accepted by the extract endpoint, with their documented price per page
// (parse component + 6 credits for the extract component).
export const MODES = {
  structure: { label: "Structure (OCR)", creditsPerPage: 7.5 },
  understand: { label: "Understand (ICR)", creditsPerPage: 15 },
  agentic: { label: "Agentic (VLM)", creditsPerPage: 24 },
};
export const DEFAULT_MODE = MODES[process.env.EXTRACTION_MODE] ? process.env.EXTRACTION_MODE : "structure";

export const KEY_HELP =
  "Get an API key at https://dashboard.nutrient.io/sign_in/. " +
  "At the time of writing, the free plan includes 5,000 credits per month to test the Data Extraction API.";

export class ExtractionError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function apiKey() {
  // Get an API key at https://dashboard.nutrient.io/sign_in/. At the time of writing, the free plan includes 5,000 credits per month to test the Data Extraction API.
  const key = process.env.NUTRIENT_API_KEY;
  if (!key) throw new ExtractionError(`NUTRIENT_API_KEY is not set: it must hold a Data Extraction API key. ${KEY_HELP}`, 500);
  return key;
}

export function hasApiKey() {
  return Boolean(process.env.NUTRIENT_API_KEY);
}

// Optional development cache: the same file, mode and schema are only paid for once.
const CACHE_DIR = process.env.EXTRACTION_CACHE_DIR || "";
const SCHEMA_HASH = createHash("sha256")
  .update(JSON.stringify([extractionSchema, extractionInstructions]))
  .digest("hex")
  .slice(0, 12);

function cachePath(buffer, mode) {
  const fileHash = createHash("sha256").update(buffer).digest("hex").slice(0, 24);
  return path.join(CACHE_DIR, `${fileHash}-${mode}-${SCHEMA_HASH}.json`);
}

async function readCache(buffer, mode) {
  if (!CACHE_DIR) return null;
  try {
    return JSON.parse(await fs.readFile(cachePath(buffer, mode), "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(buffer, mode, body) {
  if (!CACHE_DIR) return;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(buffer, mode), JSON.stringify(body, null, 2));
}

// "7.5 credits (parse 1.5 + extract 6), 4,990 remaining". The parse component is named after
// the mode the API picked, for example "agentic" when parseConfig.mode is "auto".
export function describeCost(usage) {
  const credits = usage?.data_extraction_credits;
  if (!credits) return "unknown";
  const parts = Object.entries(usage.price_composition || {}).map(([name, part]) => `${name} ${part.cost}`);
  return `${credits.cost} credits${parts.length ? ` (${parts.join(" + ")})` : ""}, ${credits.remainingCredits} remaining`;
}

/**
 * Extracts the proof-of-address fields from one document.
 * Returns the API response body ({ output: { data, metadata, pages }, metrics, usage, requestId })
 * plus { cached, elapsedMs }.
 */
export async function extractProofOfAddress({ buffer, fileName, contentType, mode = DEFAULT_MODE }) {
  if (!MODES[mode]) throw new ExtractionError(`Unknown mode "${mode}". Use one of: ${Object.keys(MODES).join(", ")}.`, 400);

  const cached = await readCache(buffer, mode);
  if (cached) return { ...cached, cached: true, elapsedMs: 0 };

  const key = apiKey();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType || "application/octet-stream" }), fileName || "document");
  form.append(
    "instructions",
    JSON.stringify({
      schema: extractionSchema,
      instructions: extractionInstructions,
      parseConfig: { mode },
      options: { includeCitations: true },
    }),
  );

  const started = Date.now();
  const response = await fetch(`${API_URL}/extraction/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  const elapsedMs = Date.now() - started;

  if (!response.ok) {
    const reason =
      response.status === 401 || response.status === 403
        ? `The API key was rejected (${response.status}). ${KEY_HELP}`
        : response.status === 402
          ? "Not enough Data Extraction credits left (402)."
          : body.errorMessage || body.message || body.details || `HTTP ${response.status}`;
    console.error(`[extract] ${fileName} mode=${mode} failed: HTTP ${response.status} requestId=${body.requestId || "-"}`);
    throw new ExtractionError(reason, response.status, body.errorDetails || body.failingPaths || null);
  }

  console.log(
    `[extract] ${fileName} mode=${mode} pages=${body.metrics?.pagesProcessed ?? "?"} ` +
      `cost=${describeCost(body.usage)} time=${elapsedMs}ms requestId=${body.requestId || "-"}`,
  );

  await writeCache(buffer, mode, body);
  return { ...body, cached: false, elapsedMs };
}
