// Proof of address check: a small Node.js server with no dependencies.
// It serves the web page, sends uploaded documents to the Nutrient Data Extraction API
// and applies the matching rules in src/rules.js.

import "./src/env.js";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODE, describeCost, ExtractionError, extractProofOfAddress, hasApiKey, KEY_HELP, MODES } from "./src/extract.js";
import { ACCEPTED_TYPES, checkProofOfAddress, LOW_GROUNDEDNESS, MAX_AGE_MONTHS } from "./src/rules.js";
import { DOCUMENT_TYPES } from "./src/schema.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const SAMPLES = path.join(ROOT, "samples");
const PORT = Number(process.env.PORT || 4740);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};
const UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff"]);

const manifest = JSON.parse(await fs.readFile(path.join(SAMPLES, "manifest.json"), "utf8"));

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function sendFile(res, file) {
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function config() {
  return {
    hasApiKey: hasApiKey(),
    keyHelp: KEY_HELP,
    modes: MODES,
    defaultMode: DEFAULT_MODE,
    acceptedTypes: ACCEPTED_TYPES.map((id) => ({ id, label: DOCUMENT_TYPES[id] })),
    maxAgeMonths: MAX_AGE_MONTHS,
    lowGroundedness: LOW_GROUNDEDNESS,
    // The Web SDK license key is meant for the browser. Empty = evaluation mode.
    webSdkLicenseKey: process.env.WEB_SDK_LICENSE_KEY || "",
    samples: manifest.map(({ file, title, applicant, expected }) => ({ file, title, applicant, expected })),
  };
}

async function readForm(req) {
  const length = Number(req.headers["content-length"] || 0);
  if (length > MAX_UPLOAD_BYTES) throw new ExtractionError("The file is larger than 20 MB.", 413);
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": req.headers["content-type"] || "" },
    body: Readable.toWeb(req),
    duplex: "half",
  });
  return request.formData();
}

async function check(req, res) {
  const form = await readForm(req);
  const file = form.get("file");
  if (!file || typeof file === "string") return sendJson(res, 400, { error: "Attach the proof-of-address document." });
  const contentType = file.type || CONTENT_TYPES[path.extname(file.name).toLowerCase()] || "";
  if (!UPLOAD_TYPES.has(contentType)) return sendJson(res, 415, { error: "Upload a PDF, JPEG, PNG or TIFF file." });

  let applicant;
  try {
    applicant = JSON.parse(form.get("applicant") || "{}");
  } catch {
    return sendJson(res, 400, { error: "The applicant data is not valid JSON." });
  }
  const mode = String(form.get("mode") || DEFAULT_MODE);
  const buffer = Buffer.from(await file.arrayBuffer());

  const response = await extractProofOfAddress({ buffer, fileName: file.name, contentType, mode });
  const result = checkProofOfAddress(applicant, response.output);
  sendJson(res, 200, {
    ...result,
    extraction: { data: response.output.data, metadata: response.output.metadata, pages: response.output.pages },
    mode,
    cost: describeCost(response.usage),
    usage: response.usage || null,
    processingTimeMs: response.metrics?.processingTimeMs ?? null,
    elapsedMs: response.elapsedMs,
    cached: response.cached,
    requestId: response.requestId || null,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/config") return sendJson(res, 200, config());
    if (req.method === "POST" && url.pathname === "/api/check") return await check(req, res);
    if (req.method === "GET" && url.pathname.startsWith("/samples/")) {
      const name = decodeURIComponent(url.pathname.slice("/samples/".length));
      if (!manifest.some((s) => s.file === name)) return sendJson(res, 404, { error: "Not found" });
      return await sendFile(res, path.join(SAMPLES, name));
    }
    if (req.method === "GET") {
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^[\w.-]+$/.test(name)) return sendJson(res, 404, { error: "Not found" });
      return await sendFile(res, path.join(PUBLIC, name));
    }
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error instanceof ExtractionError ? error.status : 500;
    if (!(error instanceof ExtractionError)) console.error(error);
    sendJson(res, status >= 400 ? status : 500, { error: error.message, details: error.details || null });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Proof of address check on http://localhost:${PORT}`);
  if (!hasApiKey()) console.warn(`NUTRIENT_API_KEY is not set: checks will fail. ${KEY_HELP}`);
});
