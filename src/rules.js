// Proof-of-address rules: compare what the applicant typed with what the Data Extraction API
// found on the document, and decide accept, review or reject with reasons and evidence.

import { DOCUMENT_TYPES } from "./schema.js";

export const ACCEPTED_TYPES = [
  "utility_bill",
  "bank_statement",
  "council_tax_bill",
  "mortgage_statement",
  "tenancy_agreement",
  "government_letter",
];
export const MAX_AGE_MONTHS = 3;
// Grounding scores below this value are shown in amber in the UI. They do not change the
// decision: on the samples, correct values scored as low as 0.14, so the rules gate on the
// citation match label instead, as the API guide recommends.
export const LOW_GROUNDEDNESS = 0.5;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function foldAccents(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[b.length];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "dame", "rev", "lord", "lady", "master"]);

// Common English short forms. Matching one sends the case to review: it is probably the
// same person, but a person should confirm it.
const SHORT_FORMS = {
  alexander: ["alex", "sandy"],
  alexandra: ["alex", "sandra", "lexi"],
  andrew: ["andy", "drew"],
  anthony: ["tony"],
  benjamin: ["ben"],
  catherine: ["cath", "cathy", "kate", "katie"],
  christopher: ["chris", "kit"],
  daniel: ["dan", "danny"],
  david: ["dave"],
  edward: ["ed", "eddie", "ted", "ned"],
  elizabeth: ["liz", "lizzie", "beth", "betty", "eliza"],
  james: ["jim", "jimmy", "jamie"],
  jennifer: ["jen", "jenny"],
  jonathan: ["jon", "jonny"],
  joseph: ["joe"],
  katherine: ["kate", "kath", "kathy", "katie", "kat"],
  margaret: ["maggie", "meg", "peggy"],
  matthew: ["matt"],
  michael: ["mike", "mick"],
  nicholas: ["nick"],
  patricia: ["pat", "trish"],
  rebecca: ["becky", "becca"],
  richard: ["rich", "rick"],
  robert: ["rob", "bob", "robbie"],
  samuel: ["sam"],
  stephen: ["steve"],
  steven: ["steve"],
  susan: ["sue", "susie"],
  thomas: ["tom", "tommy"],
  william: ["will", "bill", "billy", "liam"],
};

function isShortForm(a, b) {
  return SHORT_FORMS[a]?.includes(b) || SHORT_FORMS[b]?.includes(a);
}

const cap = (token) => token.charAt(0).toUpperCase() + token.slice(1);

export function nameTokens(name) {
  let text = foldAccents(name).toLowerCase().trim();
  // "WHITFIELD, Thomas A" is written surname first
  if (text.includes(",")) {
    const [surname, ...rest] = text.split(",");
    text = `${rest.join(" ")} ${surname}`;
  }
  return text
    .replace(/['’]/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((token) => token && !TITLES.has(token));
}

/** Compares the applicant's full name with the name printed on the document. */
export function compareNames(applicantName, documentName) {
  const app = nameTokens(applicantName);
  const doc = nameTokens(documentName);
  if (!doc.length) return { status: "review", detail: "No name found on the document." };
  if (!app.length) return { status: "review", detail: "No applicant name was entered." };

  const surname = app[app.length - 1];
  const given = app.slice(0, -1);
  const notes = [];
  let status = "pass";

  let surnameIndex = doc.indexOf(surname);
  if (surnameIndex < 0) {
    surnameIndex = doc.findIndex((t) => t.length >= 4 && levenshtein(t, surname) <= 1);
    if (surnameIndex < 0) return { status: "fail", detail: `Surname "${cap(surname)}" is not on the document.` };
    status = "review";
    notes.push(`Surname spelled "${cap(doc[surnameIndex])}" on the document.`);
  }
  const docGiven = doc.filter((_, i) => i !== surnameIndex);
  if (!given.length) return { status, detail: notes.join(" ") || "Surname matches." };
  if (!docGiven.length) return { status: "review", detail: "Only the surname is printed on the document." };

  // First given name on the document against the applicant's first given name
  const first = docGiven[0];
  const appFirst = given[0];
  if (first === appFirst) {
    // exact
  } else if (first.length === 1 && appFirst.startsWith(first)) {
    notes.push(`Initial "${first.toUpperCase()}" matches "${cap(appFirst)}".`);
  } else if (isShortForm(first, appFirst)) {
    status = "review";
    notes.push(`"${cap(first)}" is a short form of "${cap(appFirst)}": confirm it is the same person.`);
  } else if (first.length >= 4 && levenshtein(first, appFirst) <= 1) {
    status = "review";
    notes.push(`Given name spelled "${cap(first)}" on the document.`);
  } else if (given.includes(first)) {
    status = "review";
    notes.push(`The document uses "${cap(first)}", the applicant's middle name, as first name.`);
  } else {
    return { status: "fail", detail: `Given name "${cap(first)}" on the document does not match "${cap(appFirst)}".` };
  }

  // Middle names and initials
  for (const token of docGiven.slice(1)) {
    if (given.includes(token)) continue;
    if (token.length === 1 && given.slice(1).some((g) => g.startsWith(token))) {
      notes.push(`Middle name printed as the initial "${token.toUpperCase()}".`);
      continue;
    }
    if (token.length === 1) {
      status = status === "fail" ? status : "review";
      notes.push(`Middle initial "${token.toUpperCase()}" does not match the application.`);
    } else {
      notes.push(`Middle name "${cap(token)}" is on the document but not in the application.`);
    }
  }
  const missing = given.slice(1).filter((g) => !docGiven.some((t) => t === g || (t.length === 1 && g.startsWith(t))));
  if (missing.length) notes.push(`Not printed: ${missing.map(cap).join(", ")}.`);

  return { status, detail: notes.join(" ") || "Exact match." };
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

// Abbreviations and their canonical form. "St" can be Street or Saint, so both map to "st".
const ADDRESS_WORDS = {
  st: "st", street: "st", str: "st", saint: "st",
  rd: "road", road: "road",
  ave: "avenue", av: "avenue", avenue: "avenue",
  ln: "lane", lane: "lane",
  ct: "court", crt: "court", court: "court",
  cl: "close", close: "close",
  dr: "drive", drv: "drive", drive: "drive",
  cres: "crescent", cresc: "crescent", crescent: "crescent",
  pl: "place", place: "place",
  sq: "square", square: "square",
  gdns: "gardens", gardens: "gardens",
  terr: "terrace", tce: "terrace", terrace: "terrace",
  pk: "park", park: "park",
  gr: "grove", gro: "grove", grove: "grove",
  hse: "house", ho: "house", house: "house",
  mt: "mount", mount: "mount",
  flat: "flat", apartment: "flat", apt: "flat", unit: "flat",
};
const IGNORED_WORDS = new Set(["the", "and", "of", "no", "number"]);

export function parseAddress(text) {
  const tokens = foldAccents(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => ADDRESS_WORDS[t] || t);

  let flat = null;
  const numbers = [];
  const words = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "flat" && /^\d+[a-z]?$|^[a-z]$/.test(tokens[i + 1] || "")) {
      flat = tokens[++i];
    } else if (/^\d+[a-z]?$/.test(token)) {
      numbers.push(token);
    } else if (token !== "flat" && !IGNORED_WORDS.has(token)) {
      words.push(token);
    }
  }
  return { flat, numbers, words };
}

export function normalizePostcode(postcode) {
  return String(postcode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Compares the applicant's address with the recipient address extracted from the document. */
export function compareAddress(applicant, docAddress = {}) {
  const appText = [applicant.addressLine1, applicant.addressLine2, applicant.town].filter(Boolean).join(" ");
  const docText = [...(docAddress.lines || []), docAddress.town].filter(Boolean).join(" ");
  if (!docText.trim()) return { status: "review", detail: "No recipient address found on the document." };

  const app = parseAddress(appText);
  const doc = parseAddress(docText);
  const notes = [];
  let status = "pass";

  const missingNumbers = app.numbers.filter((n) => !doc.numbers.includes(n));
  if (missingNumbers.length) {
    return { status: "fail", detail: `House number ${missingNumbers.join(", ")} is not in the document address.` };
  }

  if (app.flat && doc.flat && app.flat !== doc.flat) {
    return { status: "fail", detail: `Flat ${app.flat} in the application, flat ${doc.flat} on the document.` };
  }
  if (app.flat && !doc.flat) {
    status = "review";
    notes.push(`Flat ${app.flat} is not printed on the document.`);
  }
  if (!app.flat && doc.flat) {
    status = "review";
    notes.push(`The document is for flat ${doc.flat}, the application has no flat number.`);
  }

  const appWords = [...new Set(app.words)];
  const found = appWords.filter((w) => doc.words.includes(w) || doc.words.some((d) => d.length >= 5 && levenshtein(d, w) <= 1));
  const share = appWords.length ? found.length / appWords.length : 1;
  const missingWords = appWords.filter((w) => !found.includes(w));
  if (share < 0.5) {
    return { status: "fail", detail: `Street and town do not match (missing: ${missingWords.join(", ")}).` };
  }
  if (share < 0.8) {
    status = "review";
    notes.push(`Some words are not in the document address: ${missingWords.join(", ")}.`);
  } else if (missingWords.length) {
    notes.push(`Not on the document: ${missingWords.join(", ")}.`);
  }
  return { status, detail: notes.join(" ") || "Same street, number and town after normalisation." };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function minusMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function checkDate(applicationDate, documentDate, maxAgeMonths = MAX_AGE_MONTHS) {
  const appDate = parseIsoDate(applicationDate) || parseIsoDate(formatDate(new Date()));
  const docDate = parseIsoDate(documentDate);
  if (!docDate) return { status: "review", detail: "No issue or statement date found on the document." };
  const oldest = minusMonths(appDate, maxAgeMonths);
  const days = Math.round((appDate - docDate) / 86400000);
  if (docDate > appDate) {
    return { status: "review", detail: `Dated ${formatDate(docDate)}, after the application date ${formatDate(appDate)}.` };
  }
  if (docDate < oldest) {
    return {
      status: "fail",
      detail: `Dated ${formatDate(docDate)}, ${days} days before the application. The oldest accepted date is ${formatDate(oldest)} (${maxAgeMonths} months).`,
    };
  }
  return { status: "pass", detail: `${days} days before the application. Oldest accepted: ${formatDate(oldest)} (${maxAgeMonths} months).` };
}

// ---------------------------------------------------------------------------
// Evidence from the API citations
// ---------------------------------------------------------------------------

/**
 * Turns one citation of output.metadata into evidence for the UI:
 * page, regions (render-space boxes) and grounding signals.
 */
export function evidence(field, label, value, citation) {
  if (!citation || typeof citation !== "object") return { field, label, value, match: "none", regions: [] };
  const regions = (citation.source_bboxes?.length ? citation.source_bboxes : citation.citation?.regions || [])
    .filter((r) => r?.bbox)
    .map((r) => ({ pageIndex: r.pageIndex ?? citation.pageIndex ?? 0, bbox: r.bbox }));
  if (!regions.length && citation.bbox) regions.push({ pageIndex: citation.pageIndex ?? 0, bbox: citation.bbox });
  const groundedness = citation.citation?.confidence?.groundedness ?? (typeof citation.confidence === "number" ? citation.confidence : null);
  return {
    field,
    label,
    value,
    page: citation.pageNumber ?? (citation.pageIndex ?? 0) + 1,
    match: citation.match || "none",
    status: citation.citation?.status || null,
    groundedness,
    regions,
  };
}

// A value the API could not tie to one place on the page: no citation, not found,
// an approximate match or a citation that is not "cited".
function weakEvidence(items) {
  return items.filter(
    (e) => e.match === "none" || e.match === "not_found" || e.match === "fuzzy_match" || (e.status && e.status !== "cited"),
  );
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

const RANK = { pass: 0, review: 1, fail: 2 };

/**
 * applicant: { fullName, addressLine1, addressLine2, town, postcode, applicationDate }
 * output: the `output` object of the extract response ({ data, metadata, pages })
 */
export function checkProofOfAddress(applicant, output) {
  const data = output?.data || {};
  const meta = output?.metadata || {};
  const address = data.holder_address || {};
  const addressMeta = meta.holder_address || {};
  const checks = [];

  // 1. Document type
  const type = data.document_type;
  const typeLabel = DOCUMENT_TYPES[type] || "Not recognised";
  const typeShort = typeLabel.split(" (")[0];
  const typeCheck = !type || type === "other"
    ? { status: "review", detail: "The document type was not recognised." }
    : ACCEPTED_TYPES.includes(type)
      ? { status: "pass", detail: "Accepted as proof of address." }
      : { status: "fail", detail: `${typeShort} is not accepted as proof of address.` };
  checks.push({
    id: "type",
    label: "Document type",
    application: "Accepted type",
    document: typeShort,
    ...typeCheck,
    evidence: [evidence("document_type", "Document type", type, meta.document_type)],
    groundingApplies: false,
  });

  // 2. Name
  checks.push({
    id: "name",
    label: "Name",
    application: applicant.fullName || "",
    document: data.holder_name || "",
    ...compareNames(applicant.fullName, data.holder_name),
    evidence: [evidence("holder_name", "Name", data.holder_name, meta.holder_name)],
    groundingApplies: true,
  });

  // 3. Address (street, number, flat, town)
  const lines = address.lines || [];
  checks.push({
    id: "address",
    label: "Address",
    application: [applicant.addressLine1, applicant.addressLine2, applicant.town].filter(Boolean).join(", "),
    document: [...lines, address.town].filter(Boolean).join(", "),
    ...compareAddress(applicant, address),
    evidence: [
      ...lines.map((line, i) => evidence(`holder_address.lines[${i}]`, `Address line ${i + 1}`, line, addressMeta.lines?.[i])),
      ...(address.town ? [evidence("holder_address.town", "Town", address.town, addressMeta.town)] : []),
    ],
    groundingApplies: true,
  });

  // 4. Postcode
  const appPostcode = normalizePostcode(applicant.postcode);
  const docPostcode = normalizePostcode(address.postcode);
  const postcodeCheck = !docPostcode
    ? { status: "review", detail: "No postcode found on the document." }
    : appPostcode === docPostcode
      ? { status: "pass", detail: "Same postcode." }
      : { status: "fail", detail: `Postcode ${address.postcode} on the document, ${applicant.postcode} in the application.` };
  checks.push({
    id: "postcode",
    label: "Postcode",
    application: applicant.postcode || "",
    document: address.postcode || "",
    ...postcodeCheck,
    evidence: [evidence("holder_address.postcode", "Postcode", address.postcode, addressMeta.postcode)],
    groundingApplies: true,
  });

  // 5. Document date
  checks.push({
    id: "date",
    label: "Document date",
    application: applicant.applicationDate || formatDate(new Date()),
    document: data.document_date || "",
    ...checkDate(applicant.applicationDate, data.document_date),
    evidence: [evidence("document_date", "Document date", data.document_date, meta.document_date)],
    groundingApplies: true,
  });

  // A passing check whose value the API could not ground well goes to a person.
  for (const check of checks) {
    if (!check.groundingApplies || check.status !== "pass") continue;
    const weak = weakEvidence(check.evidence.filter((e) => e.value != null && e.value !== ""));
    if (weak.length) {
      check.status = "review";
      check.detail += ` The value was not clearly located on the document (${weak.map((e) => `${e.label}: ${e.match}`).join("; ")}).`;
    }
  }

  const worst = checks.reduce((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), "pass");
  const decision = worst === "fail" ? "reject" : worst === "review" ? "review" : "accept";
  const reasons = checks
    .filter((c) => c.status !== "pass")
    .map((c) => ({ check: c.id, status: c.status, text: `${c.label}: ${c.detail}` }));
  if (!reasons.length) reasons.push({ check: "all", status: "pass", text: "Name, address, postcode, date and document type all match." });

  return {
    decision,
    reasons,
    checks: checks.map(({ groundingApplies, ...c }) => c),
    document: {
      type: data.document_type || null,
      typeLabel,
      issuer: data.issuer_name || null,
      holderName: data.holder_name || null,
      address: [...lines, address.town, address.postcode].filter(Boolean),
      date: data.document_date || null,
      reference: data.account_reference || null,
      referenceEvidence: evidence("account_reference", "Reference", data.account_reference, meta.account_reference),
      issuerEvidence: evidence("issuer_name", "Issuer", data.issuer_name, meta.issuer_name),
    },
  };
}
