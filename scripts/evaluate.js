// Runs every sample through the Data Extraction API and the rules, then prints
// the field accuracy against what is printed on each sample, the decisions and the credits used.
//
//   node scripts/evaluate.js [structure|understand|agentic]
//
// Cost: one extract call per sample (6 pages). In structure mode that is 6 x 7.5 = 45 credits.
// Set EXTRACTION_CACHE_DIR to reuse earlier responses for free.

import "../src/env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODE, extractProofOfAddress, MODES } from "../src/extract.js";
import { checkProofOfAddress, foldAccents, nameTokens, normalizePostcode } from "../src/rules.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = path.join(ROOT, "samples");
const mode = process.argv[2] || DEFAULT_MODE;
if (!MODES[mode]) {
  console.error(`Unknown mode "${mode}". Use one of: ${Object.keys(MODES).join(", ")}.`);
  process.exit(1);
}

const text = (v) => foldAccents(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const company = (v) => text(v).replace(/\b(ltd|limited|plc|llp|inc)\b/g, "").replace(/\s+/g, " ").trim();
const alnum = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Field comparisons against the printed truth in samples/manifest.json
const FIELDS = {
  document_type: (d, t) => d.document_type === t.document_type,
  issuer_name: (d, t) => company(d.issuer_name) === company(t.issuer_name),
  holder_name: (d, t) => nameTokens(d.holder_name).join(" ") === nameTokens(t.holder_name).join(" "),
  address_lines: (d, t) => text((d.holder_address?.lines || []).join(" ")) === text(t.address_lines.join(" ")),
  town: (d, t) => text(d.holder_address?.town) === text(t.town),
  postcode: (d, t) => normalizePostcode(d.holder_address?.postcode) === normalizePostcode(t.postcode),
  document_date: (d, t) => d.document_date === t.document_date,
  account_reference: (d, t) => alnum(d.account_reference) === alnum(t.account_reference),
};

const manifest = JSON.parse(await fs.readFile(path.join(SAMPLES, "manifest.json"), "utf8"));
console.log(`Mode: ${mode} (${MODES[mode].creditsPerPage} credits per page, ${manifest.length} samples)\n`);

let correctFields = 0;
let totalFields = 0;
let correctDecisions = 0;
let credits = 0;
const fieldTotals = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, 0]));

for (const sample of manifest) {
  const buffer = await fs.readFile(path.join(SAMPLES, sample.file));
  const contentType = sample.file.endsWith(".jpg") ? "image/jpeg" : "application/pdf";
  const response = await extractProofOfAddress({ buffer, fileName: sample.file, contentType, mode });
  if (!response.cached) credits += response.usage?.data_extraction_credits?.cost || 0;

  const data = response.output.data;
  const wrong = [];
  for (const [field, same] of Object.entries(FIELDS)) {
    totalFields++;
    if (same(data, sample.truth)) {
      correctFields++;
      fieldTotals[field]++;
    } else {
      wrong.push(field);
    }
  }
  const result = checkProofOfAddress(sample.applicant, response.output);
  const ok = result.decision === sample.expected.decision;
  if (ok) correctDecisions++;
  console.log(
    `${ok ? "OK  " : "DIFF"} ${sample.file.padEnd(30)} ${result.decision.padEnd(7)} (expected ${sample.expected.decision})` +
      `${response.cached ? "  [cached]" : ""}${wrong.length ? `  wrong fields: ${wrong.join(", ")}` : ""}`,
  );
  for (const reason of result.reasons.filter((r) => r.status !== "pass")) console.log(`       ${reason.status}: ${reason.text}`);
}

console.log(`\nField accuracy: ${correctFields}/${totalFields}`);
for (const [field, count] of Object.entries(fieldTotals)) console.log(`  ${field.padEnd(18)} ${count}/${manifest.length}`);
console.log(`Decisions as expected: ${correctDecisions}/${manifest.length}`);
console.log(`Credits used by this run: ${credits}${credits === 0 ? " (all responses came from the cache)" : ""}`);
