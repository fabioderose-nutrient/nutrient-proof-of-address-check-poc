// Browser side: applicant form, decision card and the Web SDK viewer that shows the evidence.
// The Data Extraction API key never reaches the browser: the server calls the API.

const $ = (id) => document.getElementById(id);
const FIELDS = ["fullName", "addressLine1", "addressLine2", "town", "postcode", "applicationDate"];
const STATUS_LABEL = { pass: "Match", review: "Review", fail: "Mismatch" };
const DECISION_LABEL = { accept: "Accept", review: "Review", reject: "Reject" };
const SDK_BASE_URL = "https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.24.0/";
const COLORS = { pass: [46, 125, 50], review: [194, 120, 3], fail: [190, 40, 40] };

const state = { config: null, file: null, result: null, instance: null, annotationIds: new Map(), viewerQueue: Promise.resolve() };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ setup */

async function init() {
  state.config = await (await fetch("/api/config")).json();
  const { config } = state;

  $("mode").innerHTML = Object.entries(config.modes)
    .map(([id, m]) => `<option value="${id}" ${id === config.defaultMode ? "selected" : ""}>${escapeHtml(m.label)}, ${m.creditsPerPage} credits per page</option>`)
    .join("");
  $("sample").insertAdjacentHTML(
    "beforeend",
    config.samples.map((s, i) => `<option value="${i}">${escapeHtml(s.file.slice(0, 2))}. ${escapeHtml(s.title)}</option>`).join(""),
  );
  $("rules").textContent =
    `Accepted: ${config.acceptedTypes.map((t) => t.label.split(" (")[0].toLowerCase()).join(", ")}. ` +
    `Dated within ${config.maxAgeMonths} months of the application.`;
  $("applicationDate").value = today();
  if (!config.hasApiKey) {
    $("key-warning").hidden = false;
    $("key-warning").textContent = "NUTRIENT_API_KEY is not set on the server.";
  }

  $("sample").addEventListener("change", loadSample);
  $("file").addEventListener("change", () => {
    const file = $("file").files[0];
    if (file) setFile(file);
  });
  $("form").addEventListener("submit", (event) => {
    event.preventDefault();
    runCheck();
  });

  const preset = new URLSearchParams(location.search).get("sample");
  if (preset) {
    $("sample").value = String(Number(preset) - 1);
    await loadSample();
    if (new URLSearchParams(location.search).has("run")) runCheck();
  }
}

async function loadSample() {
  const sample = state.config.samples[Number($("sample").value)];
  if (!sample) return;
  for (const field of FIELDS) $(field).value = sample.applicant[field] || "";
  $("sample-note").hidden = false;
  $("sample-note").textContent = `Expected: ${sample.expected.decision}. ${sample.expected.note}`;
  const blob = await (await fetch(`/samples/${encodeURIComponent(sample.file)}`)).blob();
  setFile(new File([blob], sample.file, { type: blob.type }));
}

function setFile(file) {
  state.file = file;
  $("file-name").textContent = file.name;
  showDocument(file, []);
}

/* ------------------------------------------------------------------ check */

async function runCheck() {
  if (!state.file) {
    renderError("Add a proof-of-address document first.");
    return;
  }
  const applicant = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  const body = new FormData();
  body.append("file", state.file, state.file.name);
  body.append("applicant", JSON.stringify(applicant));
  body.append("mode", $("mode").value);

  $("submit").disabled = true;
  $("result").innerHTML = `<div class="empty">Extracting with the Data Extraction API (${escapeHtml($("mode").value)} mode)...</div>`;
  try {
    const response = await fetch("/api/check", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    state.result = result;
    renderResult(result);
    await showDocument(state.file, evidenceBoxes(result));
  } catch (error) {
    renderError(error.message);
  } finally {
    $("submit").disabled = false;
  }
}

function renderError(message) {
  const withLink = escapeHtml(message).replace(/(https:\/\/[^\s]+?)(\.?\s|\.?$)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>$2');
  $("result").innerHTML = `<div class="error">${withLink}</div>`;
}

/* ----------------------------------------------------------------- render */

function evidenceChips(items, checkStatus) {
  return items
    .filter((e) => e.value != null && e.value !== "")
    .map((e) => {
      const low = e.groundedness != null && e.groundedness < state.config.lowGroundedness;
      const score = e.groundedness != null ? ` · ${e.groundedness.toFixed(2)}` : "";
      return `<button type="button" class="chip ${low ? "low" : ""}" data-field="${escapeHtml(e.field)}" data-status="${checkStatus}"
        title="${escapeHtml(`${e.label}: "${e.value}" (match ${e.match}${score ? `, grounding${score.replace(" ·", "")}` : ""})`)}">p.${e.page ?? "?"} · ${escapeHtml(e.match)}${score}</button>`;
    })
    .join("");
}

function renderResult(result) {
  const failed = result.checks.filter((c) => c.status === "fail").length;
  const review = result.checks.filter((c) => c.status === "review").length;
  const summary =
    result.decision === "accept"
      ? "All checks passed."
      : result.decision === "review"
        ? `${review} check${review > 1 ? "s" : ""} need${review > 1 ? "" : "s"} a person.`
        : `${failed} check${failed > 1 ? "s" : ""} failed.`;

  const rows = result.checks
    .map(
      (c) => `
      <tr class="${c.status}" data-check="${c.id}">
        <th scope="row">${escapeHtml(c.label)}</th>
        <td>${escapeHtml(c.application)}</td>
        <td>${escapeHtml(c.document) || '<span class="muted">not found</span>'}</td>
        <td><span class="status ${c.status}">${STATUS_LABEL[c.status]}</span><div class="detail">${escapeHtml(c.detail)}</div></td>
        <td class="evidence">${evidenceChips(c.evidence, c.status)}</td>
      </tr>`,
    )
    .join("");

  const doc = result.document;
  const infoRow = (label, value, ev) => `
      <tr class="info">
        <th scope="row">${label}</th>
        <td class="muted">-</td>
        <td>${escapeHtml(value) || '<span class="muted">not found</span>'}</td>
        <td><span class="status info">Recorded</span></td>
        <td class="evidence">${evidenceChips([ev], "info")}</td>
      </tr>`;
  const usage = result.usage?.data_extraction_credits;
  $("result").innerHTML = `
    <div class="decision ${result.decision}">
      <span class="badge">${DECISION_LABEL[result.decision]}</span>
      <div>
        <div class="summary">${escapeHtml(summary)}</div>
        <ul class="reasons">${result.reasons.map((r) => `<li class="${r.status}">${escapeHtml(r.text)}</li>`).join("")}</ul>
      </div>
    </div>

    <table class="checks">
      <thead><tr><th>Check</th><th>Application</th><th>Document</th><th>Result</th><th>Evidence</th></tr></thead>
      <tbody>${rows}${infoRow("Issuer", doc.issuer, doc.issuerEvidence)}${infoRow("Reference", doc.reference, doc.referenceEvidence)}</tbody>
    </table>

    <p class="meta">
      ${escapeHtml(result.mode)} mode · ${usage ? `${usage.cost} credits` : "cost unknown"}
      ${result.usage?.price_composition ? `(${Object.entries(result.usage.price_composition).map(([k, v]) => `${escapeHtml(k)} ${v.cost}`).join(" + ")})` : ""}
      ${result.processingTimeMs != null ? `· processed in ${(result.processingTimeMs / 1000).toFixed(1)} s` : ""}
      ${result.cached ? "· response from the local cache" : ""}
      ${result.requestId ? `· request ${escapeHtml(result.requestId)}` : ""}
    </p>`;

  for (const chip of $("result").querySelectorAll(".chip[data-field]")) {
    chip.addEventListener("click", () => focusEvidence(chip.dataset.field));
  }
}

/* ----------------------------------------------------------------- viewer */

// One rectangle per cited region, coloured by the result of the check it supports.
function evidenceBoxes(result) {
  const boxes = [];
  const seen = new Set();
  const add = (e, status) => {
    for (const region of e.regions || []) {
      const key = `${e.field}|${region.pageIndex}|${region.bbox.x}|${region.bbox.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      boxes.push({ field: e.field, label: e.label, status, pageIndex: region.pageIndex, bbox: region.bbox });
    }
  };
  for (const check of result.checks) for (const e of check.evidence) add(e, check.status);
  add(result.document.issuerEvidence, "info");
  add(result.document.referenceEvidence, "info");
  // Draw problems last so they stay on top when two fields share one text block
  const order = { info: 0, pass: 1, review: 2, fail: 3 };
  return boxes.sort((a, b) => order[a.status] - order[b.status]);
}

// Loads run one after the other: a sample load and a check can overlap.
function showDocument(file, boxes) {
  state.viewerQueue = state.viewerQueue.then(() => loadViewer(file, boxes)).catch((error) => console.error(error));
  return state.viewerQueue;
}

async function loadViewer(file, boxes) {
  const NV = window.NutrientViewer;
  if (!NV) return;
  if (state.instance) NV.unload(state.instance);
  state.instance = null;
  state.annotationIds.clear();
  const instance = await NV.load({
    container: "#viewer",
    document: await file.arrayBuffer(),
    baseUrl: SDK_BASE_URL,
    ...(state.config.webSdkLicenseKey ? { licenseKey: state.config.webSdkLicenseKey } : {}),
    toolbarItems: [{ type: "pager" }, { type: "zoom-out" }, { type: "zoom-in" }, { type: "zoom-mode" }],
    initialViewState: new NV.ViewState({ zoom: NV.ZoomMode.FIT_TO_WIDTH }),
    isEditableAnnotation: () => false,
  });
  state.instance = instance;
  if (!boxes.length || !state.result) return;

  // API boxes use the page size in output.pages (render-space pixels or points, depending on
  // the mode and the input); the viewer uses PDF points. Scale each page separately.
  const pages = state.result.extraction.pages || [];
  const annotations = boxes.map((box) => {
    const apiPage = pages.find((p) => p.page === box.pageIndex + 1) || pages[box.pageIndex] || pages[0];
    const info = instance.pageInfoForIndex(box.pageIndex);
    const sx = info.width / apiPage.width;
    const sy = info.height / apiPage.height;
    const [r, g, b] = COLORS[box.status] || [60, 90, 160];
    // Wider margin for review and mismatch boxes, so they stay visible around a shared block
    const pad = box.status === "fail" || box.status === "review" ? 5 : 2;
    return new NV.Annotations.RectangleAnnotation({
      pageIndex: box.pageIndex,
      boundingBox: new NV.Geometry.Rect({
        left: box.bbox.x * sx - pad,
        top: box.bbox.y * sy - pad,
        width: box.bbox.width * sx + 2 * pad,
        height: box.bbox.height * sy + 2 * pad,
      }),
      strokeColor: new NV.Color({ r, g, b }),
      strokeWidth: 2.5,
      strokeDashArray: box.status === "info" ? [4, 3] : null,
      customData: { field: box.field },
    });
  });
  const created = await instance.create(annotations);

  // Zoom on the part of the first page that holds the evidence
  const onFirstPage = annotations.filter((a, i) => a.pageIndex === 0 && boxes[i].status !== "info").map((a) => a.boundingBox);
  if (onFirstPage.length) {
    const left = Math.min(...onFirstPage.map((r) => r.left));
    const top = Math.min(...onFirstPage.map((r) => r.top));
    const right = Math.max(...onFirstPage.map((r) => r.left + r.width));
    const bottom = Math.max(...onFirstPage.map((r) => r.top + r.height));
    const page = instance.pageInfoForIndex(0);
    const margin = 0.06 * page.width;
    instance.jumpAndZoomToRect(
      0,
      new NV.Geometry.Rect({
        left: Math.max(0, left - margin),
        top: Math.max(0, top - margin),
        width: Math.min(page.width, right - left + 2 * margin),
        height: Math.min(page.height, bottom - top + 2 * margin),
      }),
    );
  }
  created.forEach((a, i) => {
    const field = boxes[i].field;
    if (!state.annotationIds.has(field)) state.annotationIds.set(field, []);
    state.annotationIds.get(field).push(a);
  });
}

function focusEvidence(field) {
  const instance = state.instance;
  const annotations = state.annotationIds.get(field);
  if (!instance || !annotations?.length) return;
  const first = annotations[0];
  instance.jumpToRect(first.pageIndex, first.boundingBox);
  instance.setSelectedAnnotations(window.NutrientViewer.Immutable.List(annotations.map((a) => a.id)));
}

window.addEventListener("load", () => {
  init().catch((error) => renderError(error.message));
});
