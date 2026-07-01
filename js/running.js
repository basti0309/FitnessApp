/* Running tab: log runs (manual or AI-read screenshots), show HR/pace zones
   and Riegel race predictions derived from logged runs. */
const Running = (() => {
  let el = {};
  let pendingBlocks = [];   // [{ media_type, data }] from screenshots or video frames

  // ---------- storage ----------
  const RKEY = "wodbox.runs.v1";
  const RunStore = {
    all() {
      let list;
      try { list = JSON.parse(localStorage.getItem(RKEY)) || []; } catch { list = []; }
      return list.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    },
    add(run) {
      const list = this.all();
      run.id = String(Date.now());
      list.push(run);
      localStorage.setItem(RKEY, JSON.stringify(list));
      document.dispatchEvent(new Event("data-changed"));
      return run;
    },
    remove(id) {
      localStorage.setItem(RKEY, JSON.stringify(this.all().filter((r) => r.id !== id)));
      document.dispatchEvent(new Event("data-changed"));
    },
  };

  function escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function mmss(sec) {
    if (sec == null) return "";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ---------- interval rows ----------
  function addIvRow(iv = {}) {
    const li = document.createElement("li");
    li.className = "iv-row";
    li.innerHTML = `
      <input type="text" class="iv-label" placeholder="lap" value="${escape(iv.label || "")}">
      <input type="text" class="iv-dist" placeholder="km" value="${iv.distanceKm ?? ""}" inputmode="decimal">
      <input type="text" class="iv-time" placeholder="mm:ss" value="${iv.durationSec != null ? mmss(iv.durationSec) : ""}">
      <input type="text" class="iv-hr" placeholder="hr" value="${iv.avgHr ?? ""}" inputmode="numeric">
      <button type="button" class="ex-del" title="Remove">✕</button>`;
    li.querySelector(".ex-del").addEventListener("click", () => li.remove());
    el.ivList.appendChild(li);
  }
  function readIntervals() {
    return [...el.ivList.querySelectorAll(".iv-row")].map((row) => {
      const distanceKm = parseFloat(row.querySelector(".iv-dist").value) || null;
      const durationSec = Zones.parseTime(row.querySelector(".iv-time").value) || null;
      const avgHr = parseInt(row.querySelector(".iv-hr").value, 10) || null;
      return {
        label: row.querySelector(".iv-label").value.trim() || null,
        distanceKm, durationSec, avgHr,
        paceSecPerKm: distanceKm && durationSec ? durationSec / distanceKm : null,
      };
    }).filter((iv) => iv.distanceKm || iv.durationSec || iv.label);
  }

  // ---------- GPX import ----------
  // items: [{ name, text }] — parse, skip anything already imported, save.
  function importGpxRuns(items) {
    const existing = RunStore.all();
    const isDupe = (run) => existing.some((r) =>
      (r.gpxKey && r.gpxKey === run.gpxKey) ||
      (r.date === run.date &&
        Math.abs((r.distanceKm || 0) - run.distanceKm) < 0.15 &&
        Math.abs((r.durationSec || 0) - run.durationSec) < 10));
    const out = { added: 0, skipped: 0, failed: [] };
    for (const it of items) {
      try {
        const run = GPX.parse(it.text);
        if (isDupe(run)) { out.skipped++; continue; }
        RunStore.add(run);
        existing.push(run);
        out.added++;
      } catch (err) {
        out.failed.push(`${it.name}: ${err.message}`);
      }
    }
    if (out.added) refresh();
    return out;
  }
  function gpxSummary(out) {
    const bits = [`${out.added} imported`];
    if (out.skipped) bits.push(`${out.skipped} already there`);
    if (out.failed.length) bits.push(`${out.failed.length} failed (${out.failed[0]})`);
    return bits.join(" · ");
  }
  async function onGpxFiles(files) {
    const items = [];
    for (const f of [...files]) items.push({ name: f.name, text: await f.text() });
    if (!items.length) return;
    el.gpxStatus.textContent = "Importing…";
    const out = importGpxRuns(items);
    el.gpxStatus.textContent = (out.added ? "✓ " : "") + gpxSummary(out);
  }

  // ---------- screenshots ----------
  async function onFiles(files) {
    pendingBlocks = [];
    el.shotPreview.innerHTML = "";
    el.extractBtn.disabled = true;
    for (const f of [...files]) {
      if (f.type.startsWith("image/")) pendingBlocks.push(await AI.fileToBlock(f));
    }
    pendingBlocks.forEach((b) => {
      const img = document.createElement("img");
      img.src = `data:${b.media_type};base64,${b.data}`;
      img.className = "shot-thumb";
      el.shotPreview.appendChild(img);
    });
    el.extractBtn.disabled = pendingBlocks.length === 0;
  }

  async function extract() {
    el.extractBtn.disabled = true;
    el.aiNote.textContent = "Reading with Claude…";
    try {
      const run = await AI.extractRun(pendingBlocks);
      fillForm(run);
      el.aiNote.textContent = "Filled in — review and save. ✓";
    } catch (err) {
      el.aiNote.textContent = "⚠ " + err.message;
    } finally {
      el.extractBtn.disabled = pendingBlocks.length === 0;
    }
  }

  function fillForm(run) {
    if (run.date) el.date.value = run.date;
    if (run.title) el.title.value = run.title;
    if (run.distanceKm != null) el.dist.value = run.distanceKm;
    if (run.durationSec != null) el.time.value = mmss(run.durationSec);
    if (run.avgHr != null) el.avgHr.value = run.avgHr;
    if (run.maxHr != null) el.maxHr.value = run.maxHr;
    if (run.notes) el.notes.value = run.notes;
    el.ivList.innerHTML = "";
    (run.intervals || []).forEach(addIvRow);
  }

  // ---------- derive metrics ----------
  function deriveHrMax(runs) {
    const o = Settings.hrMaxOverride();
    if (o) return { hrMax: o, basis: "from your profile" };
    let max = 0;
    runs.forEach((r) => {
      if (r.maxHr) max = Math.max(max, r.maxHr);
      if (r.avgHr) max = Math.max(max, r.avgHr);
    });
    if (max) return { hrMax: max, basis: `from your highest recorded HR (${max} bpm)` };
    return { hrMax: 190, basis: "default estimate — set Max HR in ⚙ Settings" };
  }
  function deriveThresholdPace(model) {
    const o = Settings.thrPaceOverride();
    if (o) return { pace: o, basis: "from your profile" };
    if (model && model.cs) {
      return { pace: model.cs.criticalPace, basis: "your critical speed (CS model)" };
    }
    if (model && model.predictions) {
      const tenk = model.predictions.find((p) => p.label === "10 km");
      if (tenk) return { pace: tenk.pace, basis: "≈ your predicted 10k pace" };
    }
    return null;
  }

  // ---------- renders ----------
  function renderHistory() {
    const list = RunStore.all();
    el.runCount.textContent = list.length ? `${list.length} logged` : "";
    el.emptyRuns.style.display = list.length ? "none" : "block";
    el.runList.innerHTML = list.map((r) => {
      const pace = r.distanceKm && r.durationSec ? Zones.fmtPace(r.durationSec / r.distanceKm) : "—";
      return `
        <li class="wod-item">
          <div class="wod-main">
            <div class="wod-top">
              <span class="badge run">RUN</span>
              <span class="wod-name">${escape(r.title || "Run")}</span>
            </div>
            <div class="wod-ex">${r.distanceKm ?? "—"} km · ${Zones.fmtTime(r.durationSec)} · ${pace}${r.avgHr ? " · " + r.avgHr + " bpm" : ""}</div>
            ${r.intervals?.length ? `<div class="wod-meta">${r.intervals.length} intervals</div>` : ""}
            <div class="wod-meta">${fmtDate(r.date)}</div>
            ${r.notes ? `<div class="wod-notes">${escape(r.notes)}</div>` : ""}
          </div>
          <button class="del-btn" data-id="${r.id}" title="Delete">✕</button>
        </li>`;
    }).join("");
    el.runList.querySelectorAll(".del-btn").forEach((b) =>
      b.addEventListener("click", () => {
        if (confirm("Delete this run?")) { RunStore.remove(b.dataset.id); refresh(); }
      }));
  }

  function renderZones() {
    const runs = RunStore.all();
    const { hrMax, basis } = deriveHrMax(runs);
    el.hrBasis.textContent = `Based on Max HR ${hrMax} bpm (${basis}).`;
    el.hrZoneTable.innerHTML =
      `<tr><th>Zone</th><th></th><th>BPM</th></tr>` +
      Zones.hrZones(hrMax).map((z) =>
        `<tr><td><b>${z.z}</b></td><td>${z.name}</td><td>${z.lo}–${z.hi}</td></tr>`).join("");

    const bests = Zones.bestEfforts(runs);
    const thr = deriveThresholdPace(Zones.predictRaces(bests, hrMax));
    if (!thr) {
      el.paceBasis.textContent = "Log a run (or set a threshold pace in ⚙ Settings) to see pace zones.";
      el.paceZoneTable.innerHTML = "";
      return;
    }
    el.paceBasis.textContent = `Based on threshold pace ${Zones.fmtPace(thr.pace)} (${thr.basis}).`;
    el.paceZoneTable.innerHTML =
      `<tr><th>Zone</th><th></th><th>Pace /km</th></tr>` +
      Zones.paceZones(thr.pace).map((z) =>
        `<tr><td><b>${z.z}</b></td><td>${z.name}</td><td>${Zones.fmtPace(z.slow).replace("/km", "")}–${Zones.fmtPace(z.fast)}</td></tr>`).join("");
  }

  function renderPredictions() {
    const runs = RunStore.all();
    const { hrMax } = deriveHrMax(runs);
    const bests = Zones.bestEfforts(runs);

    // Best-efforts table (fastest segment per distance, with effort).
    el.emptyBest.style.display = bests.length ? "none" : "block";
    el.bestTable.innerHTML = !bests.length ? "" :
      `<tr><th>Distance</th><th>Time</th><th>Pace</th><th>HR</th><th>Effort</th></tr>` +
      bests.map((b) => {
        const frac = b.hr && hrMax ? b.hr / hrMax : null;
        return `<tr><td>${b.label}</td><td><b>${Zones.fmtTime(b.sec)}</b></td><td>${Zones.fmtPace(b.pace)}</td>` +
          `<td>${b.hr || "—"}</td><td>${Zones.effortLabel(frac)}</td></tr>`;
      }).join("");

    // Predictions: HR-adjusted Critical Speed model (Riegel fallback).
    const model = Zones.predictRaces(bests, hrMax);
    if (!model) {
      el.predBasis.textContent = "Log a run with distance and time (splits help) to see race predictions.";
      el.predTable.innerHTML = "";
      return;
    }
    let basis = `Model: <b>${escape(model.method)}</b>. `;
    if (model.cs) {
      basis += `Critical speed ${Zones.fmtPace(model.cs.criticalPace)} (sustainable pace), anaerobic reserve D′ ≈ ${Math.round(model.cs.Dp)} m.`;
    } else {
      basis += `Single-distance estimate — log efforts at more distances (e.g. a fast 1k and a longer tempo) for the Critical Speed model.`;
    }
    if (model.corrected) basis += ` Paces are HR-adjusted up to estimated max-effort.`;
    el.predBasis.innerHTML = basis;
    el.predTable.innerHTML =
      `<tr><th>Distance</th><th>Time</th><th>Pace</th></tr>` +
      model.predictions.map((p) =>
        `<tr><td>${p.label}</td><td><b>${Zones.fmtTime(p.sec)}</b></td><td>${Zones.fmtPace(p.pace)}</td></tr>`).join("");
  }

  function refresh() {
    renderHistory();
    renderZones();
    renderPredictions();
  }

  // ---------- sub-mode switch ----------
  function setMode(mode) {
    document.querySelectorAll("#runModes .seg-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.rmode === mode));
    el.add.classList.toggle("hidden", mode !== "add");
    el.progress.classList.toggle("hidden", mode !== "progress");
    el.zones.classList.toggle("hidden", mode !== "zones");
    el.predict.classList.toggle("hidden", mode !== "predict");
    if (mode === "progress") Progress.render();
    if (mode === "zones") renderZones();
    if (mode === "predict") renderPredictions();
  }

  // ---------- init ----------
  function init() {
    el = {
      shots: document.getElementById("runShots"),
      shotPreview: document.getElementById("shotPreview"),
      extractBtn: document.getElementById("extractBtn"),
      aiNote: document.getElementById("aiNote"),
      form: document.getElementById("runForm"),
      date: document.getElementById("rnDate"),
      title: document.getElementById("rnTitle"),
      dist: document.getElementById("rnDist"),
      time: document.getElementById("rnTime"),
      avgHr: document.getElementById("rnAvgHr"),
      maxHr: document.getElementById("rnMaxHr"),
      notes: document.getElementById("rnNotes"),
      ivList: document.getElementById("ivList"),
      addIv: document.getElementById("addIv"),
      runList: document.getElementById("runList"),
      runCount: document.getElementById("runCount"),
      emptyRuns: document.getElementById("emptyRuns"),
      add: document.getElementById("runAdd"),
      progress: document.getElementById("runProgress"),
      zones: document.getElementById("runZones"),
      predict: document.getElementById("runPredict"),
      hrBasis: document.getElementById("hrBasis"),
      hrZoneTable: document.getElementById("hrZoneTable"),
      paceBasis: document.getElementById("paceBasis"),
      paceZoneTable: document.getElementById("paceZoneTable"),
      predBasis: document.getElementById("predBasis"),
      predTable: document.getElementById("predTable"),
      bestTable: document.getElementById("bestTable"),
      emptyBest: document.getElementById("emptyBest"),
    };

    el.date.value = new Date().toISOString().slice(0, 10);

    el.shots.addEventListener("change", (e) => onFiles(e.target.files));
    el.extractBtn.addEventListener("click", extract);
    el.gpxFiles = document.getElementById("gpxFiles");
    el.gpxStatus = document.getElementById("gpxStatus");
    el.gpxDriveBtn = document.getElementById("gpxDriveBtn");
    el.gpxFiles.addEventListener("change", (e) => { onGpxFiles(e.target.files); e.target.value = ""; });
    el.gpxDriveBtn.addEventListener("click", async () => {
      el.gpxDriveBtn.disabled = true;
      try { await Drive.importGpx(true, (t) => { el.gpxStatus.textContent = t; }); }
      finally { el.gpxDriveBtn.disabled = false; }
    });
    el.addIv.addEventListener("click", () => addIvRow());

    document.querySelectorAll("#runModes .seg-btn").forEach((b) =>
      b.addEventListener("click", () => setMode(b.dataset.rmode)));

    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const distanceKm = parseFloat(el.dist.value) || null;
      const durationSec = Zones.parseTime(el.time.value) || null;
      if (!distanceKm && !durationSec) { alert("Enter at least a distance or a time."); return; }
      RunStore.add({
        date: el.date.value,
        title: el.title.value.trim(),
        distanceKm,
        durationSec,
        avgHr: parseInt(el.avgHr.value, 10) || null,
        maxHr: parseInt(el.maxHr.value, 10) || null,
        intervals: readIntervals(),
        notes: el.notes.value.trim(),
      });
      el.form.reset();
      el.date.value = new Date().toISOString().slice(0, 10);
      el.ivList.innerHTML = "";
      el.shotPreview.innerHTML = "";
      pendingBlocks = [];
      el.extractBtn.disabled = true;
      el.aiNote.textContent = "Saved ✓ — log another, or check Zones & Predictions.";
      refresh();
    });

    document.addEventListener("settings-changed", refresh);
    refresh();
  }

  return { init, refresh, importGpxRuns, gpxSummary };
})();
