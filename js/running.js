/* Running tab: import runs from GPX, show HR/pace zones and run history.
   All analytics (trend, volume, zones mix, PRs) live in the Progress view. */
const Running = (() => {
  let el = {};

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
    update(id, patch) {
      localStorage.setItem(RKEY, JSON.stringify(this.all().map((r) => (r.id === id ? { ...r, ...patch } : r))));
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
  // Describe whichever HR correction(s) were applied to a run.
  function hrFixText(fix) {
    const parts = [];
    if (fix.windowSec > 0) parts.push(`HR-Start korrigiert (0:00–${Zones.fmtTime(fix.windowSec)})`);
    if (fix.effort) parts.push(`HR im Belastungsabschnitt korrigiert (${Zones.fmtTime(fix.effort.from)}–${Zones.fmtTime(fix.effort.to)})`);
    return parts.join(" · ") || "HR korrigiert";
  }
  // ---------- GPX import ----------
  // items: [{ name, text }] — parse, skip anything already imported, save.
  function importGpxRuns(items) {
    const existing = RunStore.all();
    const findDupe = (run) => existing.find((r) =>
      (r.gpxKey && r.gpxKey === run.gpxKey) ||
      (r.date === run.date &&
        Math.abs((r.distanceKm || 0) - run.distanceKm) < 0.15 &&
        Math.abs((r.durationSec || 0) - run.durationSec) < 10));
    const out = { added: 0, skipped: 0, upgraded: 0, failed: [] };
    for (const it of items) {
      try {
        const run = GPX.parse(it.text);
        const dupe = findDupe(run);
        if (dupe) {
          // same run, but stored before newer analysis existed → backfill the
          // point-exact bests / GAP / elevation / HR-cleaning instead of skipping
          const needsBests = !dupe.bests && run.bests?.length;
          const needsHrFix = run.hrFix && dupe.hrFix === undefined;
          const needsSeries = run.series && !dupe.series;
          if (needsBests || needsHrFix || needsSeries) {
            RunStore.update(dupe.id, {
              bests: run.bests,
              gapDurationSec: run.gapDurationSec,
              elevGainM: run.elevGainM,
              elevLossM: run.elevLossM,
              avgHr: run.avgHr, maxHr: run.maxHr,
              rawAvgHr: run.rawAvgHr, rawMaxHr: run.rawMaxHr, hrFix: run.hrFix,
              series: run.series,
              intervals: run.intervals?.length ? run.intervals : dupe.intervals,
            });
            out.upgraded++;
          } else out.skipped++;
          continue;
        }
        RunStore.add(run);
        existing.push(run);
        out.added++;
      } catch (err) {
        out.failed.push(`${it.name}: ${err.message}`);
      }
    }
    if (out.added || out.upgraded) refresh();
    return out;
  }
  function gpxSummary(out) {
    const bits = [`${out.added} imported`];
    if (out.upgraded) bits.push(`${out.upgraded} re-analyzed`);
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
  function importGpxText(text, source) {
    if (!text || !text.includes("<gpx")) {
      el.gpxStatus.textContent = `⚠ The ${source} doesn't contain GPX data — copying a file often puts the file (not text) on the clipboard; the file picker always works.`;
      return;
    }
    const out = importGpxRuns([{ name: source, text }]);
    el.gpxStatus.textContent = (out.added ? "✓ " : "") + gpxSummary(out);
  }
  // copied FILES land on the clipboard as files, not text — handle both
  async function pasteGpx() {
    try {
      let text = "";
      if (navigator.clipboard.read) {
        try {
          for (const item of await navigator.clipboard.read()) {
            const type = item.types.find((t) => t === "text/plain" || t.includes("gpx") || t.includes("xml"));
            if (type) { text = await (await item.getType(type)).text(); }
            if (text.includes("<gpx")) break;
          }
        } catch { /* fall through to readText */ }
      }
      if (!text && navigator.clipboard.readText) text = await navigator.clipboard.readText();
      importGpxText(text, "clipboard");
    } catch {
      el.gpxStatus.textContent = "⚠ Couldn't read the clipboard — allow paste access, press ⌘V instead, or use the file picker.";
    }
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
      const gap = r.distanceKm && r.gapDurationSec && r.elevGainM > 3
        ? ` · GAP ${Zones.fmtPace(r.gapDurationSec / r.distanceKm)}` : "";
      const elev = r.elevGainM != null ? ` · ↑${r.elevGainM} m` : "";
      return `
        <li class="wod-item" data-id="${r.id}">
          <div class="wod-main">
            <div class="wod-top">
              <span class="badge run">RUN</span>
              <span class="wod-name">${escape(r.title || "Run")}</span>
            </div>
            <div class="wod-ex">${r.distanceKm ?? "—"} km · ${Zones.fmtTime(r.durationSec)} · ${pace}${gap}${elev}${r.avgHr ? " · " + r.avgHr + " bpm" : ""}</div>
            ${r.hrFix?.corrected ? `<div class="wod-meta hr-fixed">⚠ ${hrFixText(r.hrFix)}${r.rawMaxHr ? ` · roh ${r.rawAvgHr}/${r.rawMaxHr} bpm` : ""}</div>` : ""}
            ${r.intervals?.length ? `<div class="wod-meta">${r.intervals.length} intervals</div>` : ""}
            <div class="wod-meta">${fmtDate(r.date)}</div>
            ${r.notes ? `<div class="wod-notes">${escape(r.notes)}</div>` : ""}
          </div>
          <button class="del-btn" data-id="${r.id}" title="Delete">✕</button>
        </li>`;
    }).join("");
    el.runList.querySelectorAll(".del-btn").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Delete this run?")) { RunStore.remove(b.dataset.id); refresh(); }
      }));
    el.runList.querySelectorAll(".wod-item").forEach((li) =>
      li.addEventListener("click", () => openDetail(li.dataset.id)));
  }

  // ---------- run detail: pace + HR profiles ----------
  let detailRun = null, hrMode = "corrected";
  function openDetail(id) {
    const run = RunStore.all().find((r) => r.id === id);
    if (!run) return;
    detailRun = run;
    hrMode = "corrected";
    el.rdTitle.textContent = run.title || "Run";
    const pace = run.distanceKm && run.durationSec ? Zones.fmtPace(run.durationSec / run.distanceKm) : "—";
    el.rdSub.textContent = `${fmtDate(run.date)} · ${run.distanceKm ?? "—"} km · ${Zones.fmtTime(run.durationSec)} · ${pace}`;
    const hasFix = !!(run.hrFix?.corrected && run.series?.hrRaw);
    el.rdHrToggle.hidden = !hasFix;
    el.rdHrToggle.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.hr === "corrected"));
    el.rdHrHint.textContent = hasFix
      ? `${hrFixText(run.hrFix)}. Umschalten für die Originalkurve.`
      : "";
    el.runDetail.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    // charts need a layout pass to read their width
    requestAnimationFrame(renderDetailCharts);
  }
  function closeDetail() {
    el.runDetail.classList.add("hidden");
    document.body.style.overflow = "";
    detailRun = null;
  }
  function renderDetailCharts() {
    const run = detailRun;
    if (!run) return;
    const sr = run.series;
    if (!sr) {
      el.rdPace.innerHTML = `<p class="empty">Profil erst nach Neu-Import dieses Laufs verfügbar.</p>`;
      el.rdHr.innerHTML = "";
      el.rdPaceHint.textContent = "";
      return;
    }
    const xMax = sr.t[sr.t.length - 1] || 1;
    el.rdPaceHint.textContent = "";
    Charts.area(el.rdPace, {
      points: sr.t.map((x, i) => ({ x, y: sr.pace[i] })),
      color: "#3987e5", yKind: "pace", seriesName: "Tempo", xMax,
    });
    const hrArr = hrMode === "raw" && sr.hrRaw ? sr.hrRaw : sr.hr;
    Charts.area(el.rdHr, {
      points: sr.t.map((x, i) => ({ x, y: hrArr[i] })),
      color: "#e34948", yKind: "hr", seriesName: "Puls", xMax,
    });
  }

  function renderZones() {
    const runs = RunStore.all();
    const { hrMax, basis } = deriveHrMax(runs);
    el.hrBasis.textContent = `Based on Max HR ${hrMax} bpm (${basis}).`;
    el.hrZoneTable.innerHTML =
      `<tr><th>Zone</th><th></th><th>BPM</th></tr>` +
      Zones.hrZones(hrMax).map((z) =>
        `<tr><td><b>${z.z}</b></td><td>${z.name}</td><td>${z.lo}–${z.hi}</td></tr>`).join("");

    const bests = Zones.bestEfforts(runs, { recency: true });
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

  function refresh() {
    renderHistory();
    renderZones();
  }

  // ---------- sub-mode switch ----------
  function setMode(mode) {
    document.querySelectorAll("#runModes .seg-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.rmode === mode));
    el.add.classList.toggle("hidden", mode !== "add");
    el.progress.classList.toggle("hidden", mode !== "progress");
    el.zones.classList.toggle("hidden", mode !== "zones");
    el.history.classList.toggle("hidden", mode !== "history");
    if (mode === "progress") Progress.render();
    if (mode === "zones") renderZones();
    if (mode === "history") renderHistory();
  }

  // ---------- init ----------
  function init() {
    el = {
      runList: document.getElementById("runList"),
      runCount: document.getElementById("runCount"),
      emptyRuns: document.getElementById("emptyRuns"),
      add: document.getElementById("runAdd"),
      progress: document.getElementById("runProgress"),
      zones: document.getElementById("runZones"),
      history: document.getElementById("runHistory"),
      hrBasis: document.getElementById("hrBasis"),
      hrZoneTable: document.getElementById("hrZoneTable"),
      paceBasis: document.getElementById("paceBasis"),
      paceZoneTable: document.getElementById("paceZoneTable"),
      runDetail: document.getElementById("runDetail"),
      rdTitle: document.getElementById("rdTitle"),
      rdSub: document.getElementById("rdSub"),
      rdClose: document.getElementById("rdClose"),
      rdHrToggle: document.getElementById("rdHrToggle"),
      rdHrHint: document.getElementById("rdHrHint"),
      rdPaceHint: document.getElementById("rdPaceHint"),
      rdPace: document.getElementById("rdPace"),
      rdHr: document.getElementById("rdHr"),
    };

    el.rdClose.addEventListener("click", closeDetail);
    el.runDetail.addEventListener("click", (e) => { if (e.target === el.runDetail) closeDetail(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.runDetail.classList.contains("hidden")) closeDetail(); });
    el.rdHrToggle.querySelectorAll(".seg-btn").forEach((b) =>
      b.addEventListener("click", () => {
        hrMode = b.dataset.hr;
        el.rdHrToggle.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("is-active", x === b));
        renderDetailCharts();
      }));

    el.gpxFiles = document.getElementById("gpxFiles");
    el.gpxStatus = document.getElementById("gpxStatus");
    el.gpxDriveBtn = document.getElementById("gpxDriveBtn");
    el.gpxPasteBtn = document.getElementById("gpxPasteBtn");
    el.gpxFiles.addEventListener("change", (e) => { onGpxFiles(e.target.files); e.target.value = ""; });
    el.gpxDriveBtn.addEventListener("click", async () => {
      el.gpxDriveBtn.disabled = true;
      try { await Drive.importGpx(true, (t) => { el.gpxStatus.textContent = t; }); }
      finally { el.gpxDriveBtn.disabled = false; }
    });
    el.gpxPasteBtn.addEventListener("click", pasteGpx);
    // ⌘V / Ctrl+V anywhere on the Run tab imports GPX from the clipboard —
    // as pasted text OR as a pasted/copied .gpx file
    document.addEventListener("paste", (e) => {
      if (!document.getElementById("tab-run").classList.contains("is-active")) return;
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      const files = [...(e.clipboardData?.files || [])]
        .filter((f) => /\.gpx$/i.test(f.name) || (f.type || "").includes("gpx") || (f.type || "").includes("xml"));
      if (files.length) { e.preventDefault(); onGpxFiles(files); return; }
      const text = e.clipboardData?.getData("text") || "";
      if (text.includes("<gpx")) { e.preventDefault(); importGpxText(text, "clipboard"); }
    });

    document.querySelectorAll("#runModes .seg-btn").forEach((b) =>
      b.addEventListener("click", () => setMode(b.dataset.rmode)));

    document.addEventListener("settings-changed", refresh);
    refresh();
  }

  return { init, refresh, importGpxRuns, gpxSummary };
})();
