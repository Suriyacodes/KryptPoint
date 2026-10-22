(() => {
  "use strict";

  const CFG = window.KRYPTPOINT_CONFIG;
  const VERDICTS = {
    potentially_manipulated: {
      title: "Potentially manipulated",
      desc: "The model flagged signs consistent with manipulation. This is a model output, not proof.",
    },
    no_manipulation_detected: {
      title: "No manipulation detected",
      desc: "The model did not detect manipulation. This does not prove the image is authentic.",
    },
    inconclusive: {
      title: "Inconclusive",
      desc: "The model could not reach a reliable conclusion for this image.",
    },
  };
  const VERIFY_STATUS = { verified: "Verified", failed: "Verification failed", inconclusive: "Inconclusive" };
  const RING_C = 2 * Math.PI * 52;

  /* ---------------------------------------------------------------- helpers */
  const $ = (id) => document.getElementById(id);
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const svgIcon = (name) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("class", "ic");
    const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
    u.setAttribute("href", `#i-${name}`);
    s.append(u);
    return s;
  };
  const clear = (el) => { el.replaceChildren(); return el; };
  const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
  const fmtDate = (s) => { const d = new Date(s); return isNaN(d) ? String(s ?? "unknown time") : d.toLocaleString(); };
  const asText = (x) => typeof x === "string" ? x : (x && (x.message || x.text || x.description)) || JSON.stringify(x);
  const typeNames = () => CFG.ACCEPTED_TYPES.map((t) => t.replace("image/", "").toUpperCase()).join(", ");
  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }
  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

  /* ------------------------------------------------------------- API client */
  class ApiError extends Error {
    constructor(message, { status, network } = {}) { super(message); this.status = status; this.network = !!network; }
  }
  async function request(path, opts = {}, timeout = CFG.REQUEST_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(CFG.API_BASE_URL + path, { ...opts, signal: ctrl.signal });
    } catch (e) {
      throw new ApiError(
        e.name === "AbortError" ? "The request timed out."
          : `Cannot reach the backend at ${CFG.API_BASE_URL}. Check that it is running and that CORS allows this origin.`,
        { network: true });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let detail = "";
      try { const j = await res.clone().json(); detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j); } catch { /* not JSON */ }
      throw new ApiError(detail || `Backend returned HTTP ${res.status}.`, { status: res.status });
    }
    return res;
  }
  const api = {
    async analyze(file) { const fd = new FormData(); fd.append("file", file); return (await request("/api/analyze", { method: "POST", body: fd })).json(); },
    async history() { return (await request("/api/history")).json(); },
    async verify(file, report) { const fd = new FormData(); fd.append("file", file); fd.append("report", report); return (await request("/api/verify", { method: "POST", body: fd })).json(); },
    async report(id) { return (await request(`/api/report/${encodeURIComponent(id)}`)).blob(); },
  };

  /*
   * Response adapter. Field names are ASSUMPTIONS until the backend schema is
   * published; change them here only.
   */
  function normalizeAnalysis(raw) {
    if (!raw || typeof raw !== "object" || !(raw.verdict in VERDICTS)) {
      throw new ApiError("The backend response did not contain a recognised verdict. Check the API schema.");
    }
    const list = (v) => (Array.isArray(v) ? v.map(asText) : null);
    return {
      id: raw.analysis_id ?? null,
      verdict: raw.verdict,
      score: typeof raw.score === "number" ? raw.score : null,
      warnings: list(raw.quality_warnings),
      findings: list(raw.findings),
      limitations: list(raw.limitations),
      filename: raw.filename ?? null,
      createdAt: raw.created_at ?? null,
      matches: Array.isArray(raw.possible_matches) ? raw.possible_matches : [],
    };
  }

  /* ------------------------------------------------------------------ state */
  const state = { file: null, previewUrl: null, dims: null, analysis: null, busy: false };

  /* ------------------------------------------------------------- navigation */
  const NAV = {
    new: { view: "analyze", reset: true },
    image: { view: "analyze" },
    assistant: { view: "analyze", focus: "assistant-card" },
    history: { view: "history" },
    reports: { view: "reports" },
    settings: { view: "settings" },
    video: { todo: "Video Analysis", note: "Video analysis is not implemented. The backend currently analyzes still images only." },
    audio: { todo: "Audio Analysis", note: "Audio analysis is not implemented. The backend currently analyzes still images only." },
    document: { todo: "Document Analysis", note: "Document analysis is not implemented. The backend currently analyzes still images only." },
    metadata: { todo: "Metadata Explorer", note: "A dedicated metadata explorer is not implemented. Basic file details read in your browser appear on the Analyze screen." },
    compare: { todo: "Comparative Analysis", note: "Comparative analysis is not implemented in this UI. Possible matches returned by the backend appear under Case Files." },
    lab: { todo: "Evidence Lab", note: "The Evidence Lab is not implemented in this UI." },
  };
  const VIEWS = ["analyze", "history", "reports", "settings", "todo"];

  function go(key) {
    const n = NAV[key];
    if (!n) return;
    if (n.reset) resetAll();
    const view = n.todo ? "todo" : n.view;
    VIEWS.forEach((v) => ($(`view-${v}`).hidden = v !== view));
    if (n.todo) { $("todo-title").textContent = n.todo; $("todo-text").textContent = n.note; }
    document.querySelectorAll("[data-nav]").forEach((el) => {
      const on = el.dataset.nav === key;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    closeSidebar();
    if (view === "history") loadHistory();
    if (view === "settings") renderSettings();
    if (n.focus) { const t = $(n.focus); t.scrollIntoView({ behavior: "smooth", block: "center" }); t.focus({ preventScroll: true }); }
    else window.scrollTo({ top: 0 });
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-nav]");
    if (t && !t.disabled) go(t.dataset.nav);
  });

  const sidebar = $("sidebar"), scrim = $("scrim"), menuBtn = $("menu-btn");
  function openSidebar() { sidebar.classList.add("open"); scrim.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); }
  function closeSidebar() { sidebar.classList.remove("open"); scrim.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
  menuBtn.addEventListener("click", () => (sidebar.classList.contains("open") ? closeSidebar() : openSidebar()));
  scrim.addEventListener("click", closeSidebar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSidebar(); });

  /* ---------------------------------------------------------- backend check */
  async function pingBackend() {
    const card = $("backend-card");
    card.dataset.state = "checking"; $("backend-text").textContent = "Checking connection…";
    try {
      // Uses the documented GET /api/history purely as a reachability check.
      await request("/api/history", {}, 5000);
      card.dataset.state = "online"; $("backend-text").textContent = "Connected";
    } catch (e) {
      card.dataset.state = "offline";
      $("backend-text").textContent = e.network ? "Unreachable" : `Responded with an error${e.status ? ` (HTTP ${e.status})` : ""}`;
    }
  }
  $("backend-recheck").addEventListener("click", pingBackend);

  /* ---------------------------------------------------------- file handling */
  $("dz-hint").textContent = `${typeNames()} · up to ${CFG.MAX_FILE_MB} MB`;
  const dz = $("dropzone"), fileInput = $("file-input");

  function validateImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("No file selected."));
      if (!CFG.ACCEPTED_TYPES.includes(file.type)) return reject(new Error(`Unsupported file type “${file.type || "unknown"}”. Accepted: ${typeNames()}.`));
      if (file.size === 0) return reject(new Error("The file is empty."));
      if (file.size > CFG.MAX_FILE_MB * 1048576) return reject(new Error(`File is ${fmtBytes(file.size)}; the limit is ${CFG.MAX_FILE_MB} MB.`));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This file could not be decoded as an image. It may be corrupted.")); };
      img.src = url;
    });
  }

  async function setFile(file) {
    showError($("upload-error"), "");
    try {
      const info = await validateImage(file);
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.file = file; state.previewUrl = info.url; state.dims = `${info.width} × ${info.height}px`; state.analysis = null;
      $("viewer-img").src = info.url; $("img-wrap").hidden = false; $("viewer-empty").hidden = true;
      const chip = $("file-chip"); chip.hidden = false; chip.textContent = `${file.name} · ${fmtBytes(file.size)}`;
      $("analyze-btn").disabled = false; $("clear-btn").disabled = false;
      renderAnalysisEmpty("Ready. Press “Analyze image” to run the backend analysis.");
      renderMeta(); renderLlm(); syncReportButtons();
      setVTab("original");
    } catch (e) { showError($("upload-error"), e.message); }
  }

  function resetAll() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, { file: null, previewUrl: null, dims: null, analysis: null });
    $("viewer-img").removeAttribute("src"); $("img-wrap").hidden = true; $("viewer-empty").hidden = false; $("scan").hidden = true;
    $("file-chip").hidden = true; fileInput.value = ""; showError($("upload-error"), "");
    $("analyze-btn").disabled = true; $("clear-btn").disabled = true;
    renderAnalysisEmpty("No analysis yet. Select an image and press “Analyze image”.");
    renderMeta(); renderLlm(); syncReportButtons(); setVTab("original");
  }

  fileInput.addEventListener("change", () => fileInput.files[0] && setFile(fileInput.files[0]));
  dz.addEventListener("click", (e) => { if (!e.target.closest("button")) fileInput.click(); });
  $("choose-btn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  $("tile-image").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  dz.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === dz) { e.preventDefault(); fileInput.click(); } });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 1) showError($("upload-error"), "Please drop a single image; using the first file.");
    if (files[0]) setFile(files[0]);
  });
  $("clear-btn").addEventListener("click", resetAll);

  /* ----------------------------------------------------------- viewer tabs */
  const VTAB_TEXT = {
    ai: ["AI Analysis view", "Model visualisations such as manipulation heatmaps are not implemented: the backend contract returns no heatmap or localisation data."],
    overlay: ["Forensic Overlay", "Forensic overlays are not implemented: the backend contract returns no overlay data."],
    frames: ["Frame Analysis", "Frame analysis applies to video, which the backend does not currently support."],
  };
  function setVTab(name) {
    document.querySelectorAll(".vtab").forEach((b) => {
      const on = b.dataset.vtab === name;
      b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on));
    });
    const orig = name === "original";
    $("viewer-original").hidden = !orig; $("viewer-unimpl").hidden = orig;
    if (!orig) { $("unimpl-title").textContent = VTAB_TEXT[name][0]; $("unimpl-text").textContent = VTAB_TEXT[name][1]; }
  }
  document.querySelectorAll(".vtab").forEach((b) => b.addEventListener("click", () => setVTab(b.dataset.vtab)));

  /* --------------------------------------------------------- render: panels */
  function renderAnalysisEmpty(text) {
    const p = $("analysis-panel"); delete p.dataset.verdict;
    clear($("analysis-body")).append(h("div", { class: "empty" }, h("p", {}, text)));
  }

  function renderLoading() {
    const p = $("analysis-panel"); delete p.dataset.verdict;
    const label = h("span", {}, "Uploading and analysing…");
    clear($("analysis-body")).append(h("div", { class: "loading" }, h("div", { class: "spinner" }), label));
    return label;
  }

  function renderAnalysis(a) {
    const panel = $("analysis-panel"); panel.dataset.verdict = a.verdict;
    const info = VERDICTS[a.verdict];
    const inUnit = a.score !== null && a.score >= 0 && a.score <= 1;
    const fill = h("circle", { class: "fill", cx: 60, cy: 60, r: 52, fill: "none", "stroke-width": 10 });
    fill.setAttribute("stroke-dasharray", RING_C.toFixed(2));
    fill.setAttribute("stroke-dashoffset", (inUnit ? RING_C * (1 - a.score) : RING_C).toFixed(2));
    const track = h("circle", { class: "track", cx: 60, cy: 60, r: 52, fill: "none", "stroke-width": 10 });
    const ring = h("div", { class: "ring" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    [track, fill].forEach((c) => { const n = document.createElementNS("http://www.w3.org/2000/svg", "circle"); [...c.attributes].forEach((at) => n.setAttribute(at.name, at.value)); svg.append(n); });
    ring.append(svg, h("div", { class: "val" }, h("b", {}, a.score === null ? "n/a" : String(a.score)), h("small", {}, "Model score")));

    const findings = a.findings === null ? h("p", { class: "not-provided" }, "Findings were not provided by the backend.")
      : a.findings.length === 0 ? h("p", { class: "not-provided" }, "The backend reported no findings.")
      : h("ul", { class: "find-list" }, a.findings.map((f) => h("li", {}, svgIcon("search"), h("span", {}, f))));

    clear($("analysis-body")).append(
      h("div", { class: "verdict-row" },
        h("div", {},
          h("h2", { class: "verdict-title" }, svgIcon("warn"), info.title),
          h("div", { class: "meta mono verdict-enum" }, `verdict: ${a.verdict}`),
          h("p", { class: "meta" }, info.desc)),
        ring),
      h("p", { class: "meta" }, CFG.SCORE_IS_CALIBRATED
        ? "The backend states this score is calibrated."
        : `Raw model score${inUnit ? " (shown on a 0–1 ring)" : ""}. It is not a calibrated probability or a percentage chance.`),
      h("div", { class: "section-title" }, "Key Findings"),
      findings,
      a.id != null ? h("p", { class: "meta" }, "Analysis ID: ", h("span", { class: "mono" }, a.id)) : h("p", { class: "meta" }, "Analysis ID not provided by the backend."),
    );
  }

  function renderFailure(err, retry) {
    const p = $("analysis-panel"); delete p.dataset.verdict;
    clear($("analysis-body")).append(
      h("div", { class: "alert error", role: "alert" }, err.network ? "Connection problem. " : "Analysis failed. ", err.message),
      retry && h("button", { class: "btn", onclick: retry }, "Try again"));
  }

  function renderMeta() {
    const dl = clear($("meta-body"));
    const f = state.file, a = state.analysis;
    if (!f && !a) return dl.append(h("div", { class: "empty small" }, "No file selected."));
    const rows = [];
    if (f) rows.push(["File name", f.name], ["File type", f.type], ["File size", fmtBytes(f.size)], ["Resolution", state.dims], ["Last modified", fmtDate(f.lastModified)]);
    else if (a?.filename) rows.push(["File name", a.filename]);
    if (a?.id != null) rows.push(["Analysis ID", a.id]);
    if (a?.createdAt) rows.push(["Analyzed", fmtDate(a.createdAt)]);
    if (!f && a) rows.push(["Preview", "Not available (no image endpoint)"]);
    rows.forEach(([k, v]) => dl.append(h("div", {}, h("dt", {}, k), h("dd", {}, v))));
  }

  function renderLlm() {
    const box = clear($("llm-body")), a = state.analysis;
    if (!a) return box.append(h("div", { class: "empty small" }, "Run an analysis to see warnings and limitations returned by the backend."));
    const sec = (title, items, cls, empty, icon) => h("div", {},
      h("div", { class: "section-title" }, title),
      items === null ? h("p", { class: "not-provided" }, "Not provided by the backend.")
        : items.length === 0 ? h("p", { class: "not-provided" }, empty)
        : h("ul", { class: `find-list ${cls}` }, items.map((t) => h("li", {}, svgIcon(icon), h("span", {}, t)))));
    box.append(sec("Quality warnings", a.warnings, "warn", "No quality warnings reported.", "warn"),
      sec("Limitations", a.limitations, "muted", "No limitations reported.", "info"));
  }

  function syncReportButtons() {
    const id = state.analysis?.id;
    $("report-btn").disabled = id == null; $("reports-download").disabled = id == null;
    $("reports-last").textContent = id != null ? `Latest analysis ID: ${id}` : "Analyze an image first, or open one from Case Files, to enable the PDF download.";
  }

  async function downloadReport(btn) {
    const id = state.analysis?.id; if (id == null) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Downloading…";
    try {
      const blob = await api.report(id);
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: `kryptpoint-report-${id}.pdf` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("Report downloaded.");
    } catch (e) { toast(`Report download failed: ${e.message}`); }
    finally { btn.textContent = label; syncReportButtons(); }
  }
  $("report-btn").addEventListener("click", (e) => downloadReport(e.currentTarget));
  $("reports-download").addEventListener("click", (e) => downloadReport(e.currentTarget));

  /* ----------------------------------------------------------- run analysis */
  async function runAnalysis() {
    if (!state.file || state.busy) return;
    const file = state.file;
    state.busy = true; $("analyze-btn").disabled = true; $("scan").hidden = false; setVTab("original");
    const label = renderLoading(); const started = Date.now();
    const tick = setInterval(() => { label.textContent = `Uploading and analysing… ${Math.round((Date.now() - started) / 1000)}s`; }, 1000);
    try {
      const a = normalizeAnalysis(await api.analyze(file));
      if (state.file === file) { state.analysis = a; renderAnalysis(a); renderMeta(); renderLlm(); syncReportButtons(); }
    } catch (e) { renderFailure(e, runAnalysis); }
    finally { clearInterval(tick); state.busy = false; $("scan").hidden = true; $("analyze-btn").disabled = !state.file; }
  }
  $("analyze-btn").addEventListener("click", runAnalysis);

  /* ----------------------------------------------------------- case files */
  async function loadHistory() {
    const list = $("history-list");
    clear(list).append(h("div", { class: "loading" }, h("div", { class: "spinner" }), "Loading case files…"));
    try {
      const raw = await api.history();
      if (!Array.isArray(raw)) throw new ApiError("Unexpected history format (expected a JSON array). Check the API schema.");
      const items = []; let skipped = 0;
      raw.forEach((r) => { try { items.push(normalizeAnalysis(r)); } catch { skipped++; } });
      clear(list);
      if (skipped) list.append(h("div", { class: "alert warn" }, `${skipped} record(s) had no recognised verdict and were hidden.`));
      if (!items.length) return list.append(h("div", { class: "empty" }, h("p", {}, "No analyses yet. Analyze an image to start a case file.")));
      items.forEach((it) => list.append(historyRow(it)));
    } catch (e) {
      clear(list).append(h("div", { class: "alert error", role: "alert" }, e.network ? "Connection problem. " : "Could not load case files. ", e.message),
        h("button", { class: "btn", onclick: loadHistory }, "Try again"));
    }
  }
  $("history-refresh").addEventListener("click", loadHistory);

  function historyRow(it) {
    return h("article", { class: "hist-row", "data-verdict": it.verdict },
      h("div", {}, h("strong", {}, it.filename ?? "Unnamed file"),
        h("div", { class: "meta" }, it.createdAt ? fmtDate(it.createdAt) : "Time not provided", " · ", h("span", { class: "mono" }, `ID ${it.id ?? "unknown"}`))),
      h("span", { class: "vbadge" }, VERDICTS[it.verdict].title),
      h("button", { class: "btn small", onclick: () => openEarlier(it) }, "Open analysis"),
      it.matches.length ? h("div", { class: "matches" },
        h("strong", {}, `Possible matches (${it.matches.length}) `), "visual similarity only, not proof of identity: ",
        it.matches.map((m) => `${m.filename ?? m.analysis_id ?? "unknown"}${m.similarity != null ? ` (similarity value ${m.similarity})` : ""}`).join("; ")) : null);
  }

  function openEarlier(it) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, { file: null, previewUrl: null, dims: null, analysis: it });
    $("viewer-img").removeAttribute("src"); $("img-wrap").hidden = true; $("viewer-empty").hidden = false;
    $("file-chip").hidden = true; $("analyze-btn").disabled = true; $("clear-btn").disabled = true;
    go("image");
    renderAnalysis(it); renderMeta(); renderLlm(); syncReportButtons();
  }

  /* --------------------------------------------------------------- verify */
  const vFile = $("verify-file"), vReport = $("verify-report");
  const syncVerify = () => ($("verify-btn").disabled = !(vFile.files[0] && vReport.files[0]));
  vFile.addEventListener("change", syncVerify); vReport.addEventListener("change", syncVerify);
  $("verify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = vFile.files[0], report = vReport.files[0], out = $("verify-result");
    showError($("verify-error"), "");
    try { await validateImage(file); } catch (err) { return showError($("verify-error"), `Original image: ${err.message}`); }
    if (report.type !== "application/pdf" && !/\.pdf$/i.test(report.name)) return showError($("verify-error"), "The report must be a PDF file.");
    if (report.size === 0 || report.size > CFG.MAX_REPORT_MB * 1048576) return showError($("verify-error"), `The report must be non-empty and under ${CFG.MAX_REPORT_MB} MB.`);
    $("verify-btn").disabled = true;
    clear(out).append(h("div", { class: "loading" }, h("div", { class: "spinner" }), "Verifying with the backend…"));
    try {
      const r = await api.verify(file, report);
      const status = r && r.status in VERIFY_STATUS ? r.status : null;
      clear(out);
      if (!status) out.append(h("div", { class: "alert warn" }, "The backend returned a response this UI does not recognise, so nothing is shown as verified. Check the API schema."));
      else out.append(h("div", { class: `status-big s-${status}` }, VERIFY_STATUS[status]), h("div", { class: "meta mono" }, `status: ${status}`),
        r.detail ? h("p", {}, asText(r.detail)) : null,
        status === "inconclusive" ? h("p", { class: "meta" }, "Verification reached no conclusion. This is not a pass.") : null);
    } catch (err) {
      clear(out).append(h("div", { class: "alert error", role: "alert" }, (err.network ? "Connection problem. " : "Verification failed to run. ") + err.message));
    } finally { syncVerify(); }
  });

  /* ------------------------------------------------------------- settings */
  function renderSettings() {
    $("settings-api").textContent = CFG.API_BASE_URL;
    $("settings-types").textContent = typeNames();
    $("settings-size").textContent = `${CFG.MAX_FILE_MB} MB`;
  }

  /* ----------------------------------------------------------------- init */
  go("image");
  pingBackend();
})();
