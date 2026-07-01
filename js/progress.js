/* Progress: Strava/Zepp-style analytics over the logged runs and WODs.
   - Stat tiles (last 4 weeks vs the 4 weeks before)
   - Prediction trend: predicted race time recomputed date-by-date as runs
     accumulate (the model only ever sees runs up to that date)
   - Weekly distance (last 12 weeks)
   - Time in HR zones (last 4 weeks)
   - Personal records with the date they were set
   Chart colors are the validated dark-surface palette (see charts.js rules). */
const Progress = (() => {
  const C1 = "#3987e5";                                     // series slot 1 (blue)
  const ZONE_RAMP = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"]; // ordinal Z1→Z5
  const RKEY = "wodbox.runs.v1";
  let el = {};
  let target = "5 km";   // selected prediction distance
  let rangeDays = null;  // displayed window for the trend chart (null = all)
  const RANGES = [
    { days: 90, label: "3 mo" }, { days: 180, label: "6 mo" },
    { days: 365, label: "1 yr" }, { days: null, label: "All" },
  ];

  function runsAll() {
    let list;
    try { list = JSON.parse(localStorage.getItem(RKEY)) || []; } catch { list = []; }
    return list.filter((r) => r.date).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id)); // oldest first
  }
  function hrMaxFor(runs) {
    const o = Settings.hrMaxOverride();
    if (o) return o;
    let max = 0;
    runs.forEach((r) => { if (r.maxHr) max = Math.max(max, r.maxHr); if (r.avgHr) max = Math.max(max, r.avgHr); });
    return max || 190;
  }
  function dayMs(iso) { return new Date(iso + "T00:00:00").getTime(); }
  function isoOf(d) { return d.toISOString().slice(0, 10); }
  function mondayOf(iso) {
    const d = new Date(iso + "T00:00:00");
    const off = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - off);
    return d;
  }

  /* ---------- prediction evolution (the model replayed through time) ---------- */
  function evolution(runs, label) {
    const dates = [...new Set(runs.map((r) => r.date))];
    const pts = [];
    for (const date of dates) {
      const subset = runs.filter((r) => r.date <= date);
      const model = Zones.predictRaces(Zones.bestEfforts(subset), hrMaxFor(subset));
      const p = model && model.predictions.find((q) => q.label === label);
      if (p && isFinite(p.sec) && p.sec > 0) pts.push({ x: dayMs(date), xLabel: date, y: Math.round(p.sec) });
    }
    return pts;
  }

  function renderEvolution() {
    const runs = runsAll();
    let pts = evolution(runs, target);
    const hadAny = pts.length > 0;
    if (rangeDays) {
      const cutoff = Date.now() - rangeDays * 86400000;
      pts = pts.filter((p) => p.x >= cutoff);
    }

    el.predChips.querySelectorAll(".chip").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.t === target));
    el.evoRange.querySelectorAll(".chip").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.days === String(rangeDays)));

    if (pts.length < 2) {
      el.evoChart.replaceChildren();
      el.emptyEvo.classList.remove("hidden");
      el.emptyEvo.textContent =
        hadAny && rangeDays ? `Fewer than two data points in the last ${RANGES.find((r) => r.days === rangeDays).label} — pick a wider range.`
        : pts.length === 1 ? "One data point so far — log another run and the trend line appears."
        : "Log runs (splits help) to see how your predicted times develop.";
      return;
    }
    el.emptyEvo.classList.add("hidden");
    Charts.line(el.evoChart, {
      points: pts,
      color: C1,
      yKind: "time",
      seriesName: `Predicted ${target}`,
      tableCols: ["Date", `Predicted ${target}`, "Pace"],
      tableRows: pts.map((p) => {
        const km = Zones.TARGETS.find((t) => t.label === target).km;
        return [p.xLabel, Zones.fmtTime(p.y), Zones.fmtPace(p.y / km)];
      }),
    });
  }

  /* ---------- stat tiles ---------- */
  function sumStats(runs, fromMs, toMs) {
    let km = 0, sec = 0, n = 0;
    runs.forEach((r) => {
      const t = dayMs(r.date);
      if (t >= fromMs && t < toMs) { km += r.distanceKm || 0; sec += r.durationSec || 0; n++; }
    });
    return { km, sec, n };
  }
  function tile(label, value, delta, deltaGood) {
    const t = document.createElement("div");
    t.className = "stat-tile";
    const l = document.createElement("div"); l.className = "stat-label"; l.textContent = label;
    const v = document.createElement("div"); v.className = "stat-value"; v.textContent = value;
    t.appendChild(l); t.appendChild(v);
    if (delta) {
      const d = document.createElement("div");
      d.className = "stat-delta " + (deltaGood == null ? "" : deltaGood ? "is-good" : "is-bad");
      d.textContent = delta;
      t.appendChild(d);
    }
    return t;
  }
  function renderTiles() {
    const runs = runsAll();
    const now = Date.now();
    const W4 = 28 * 86400000;
    const cur = sumStats(runs, now - W4, now + 86400000);
    const prev = sumStats(runs, now - 2 * W4, now - W4);

    const grid = el.statGrid;
    grid.replaceChildren();
    const dKm = cur.km - prev.km;
    grid.appendChild(tile("Distance · 4 wk", `${cur.km.toFixed(1)} km`,
      prev.km || cur.km ? `${dKm >= 0 ? "▲" : "▼"} ${Math.abs(dKm).toFixed(1)} km vs prior 4 wk` : "", dKm >= 0));
    grid.appendChild(tile("Runs · 4 wk", String(cur.n),
      `${cur.sec ? Zones.fmtTime(cur.sec) + " on feet" : "—"}`, null));

    // predicted target time now vs 4 weeks ago
    const pts = evolution(runs, target);
    if (pts.length) {
      const nowP = pts[pts.length - 1];
      const before = [...pts].reverse().find((p) => p.x <= now - W4);
      const dSec = before ? nowP.y - before.y : null;
      grid.appendChild(tile(`Predicted ${target}`, Zones.fmtTime(nowP.y),
        dSec == null || dSec === 0 ? "stable" : `${dSec < 0 ? "▼" : "▲"} ${Zones.fmtTime(Math.abs(dSec))} vs 4 wk ago`,
        dSec == null ? null : dSec <= 0));
    } else {
      grid.appendChild(tile(`Predicted ${target}`, "—", "log a run", null));
    }

    const wods = Store.all().filter((w) => dayMs(w.date) >= now - W4).length;
    grid.appendChild(tile("WODs · 4 wk", String(wods), "", null));
  }

  /* ---------- weekly distance ---------- */
  function renderVolume() {
    const runs = runsAll();
    const weeks = [];
    const start = mondayOf(isoOf(new Date()));
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start); d.setDate(d.getDate() - i * 7);
      weeks.push({ key: isoOf(d), km: 0, n: 0 });
    }
    const byKey = new Map(weeks.map((w) => [w.key, w]));
    runs.forEach((r) => {
      const w = byKey.get(isoOf(mondayOf(r.date)));
      if (w) { w.km += r.distanceKm || 0; w.n++; }
    });
    const items = weeks.map((w) => {
      const d = new Date(w.key + "T00:00:00");
      const lab = d.toLocaleDateString(undefined, { day: "numeric", month: "numeric" });
      return { label: lab, value: +w.km.toFixed(1), sub: `Week of ${lab} · ${w.n} run${w.n === 1 ? "" : "s"}` };
    });
    const total = items.reduce((a, i) => a + i.value, 0);
    if (!total) {
      el.volNote.textContent = "Last 12 weeks — no runs in this window yet.";
      el.volChart.replaceChildren();
      return;
    }
    el.volNote.textContent = `Last 12 weeks · ${total.toFixed(1)} km total.`;
    Charts.bars(el.volChart, {
      items, color: C1, unit: " km",
      fmt: (v) => `${v} km`,
      tableCols: ["Week of", "Distance", "Runs"],
      tableRows: weeks.map((w) => [w.key, `${w.km.toFixed(1)} km`, String(w.n)]),
    });
  }

  /* ---------- time in HR zones (last 4 weeks) ---------- */
  function renderZoneDist() {
    const runs = runsAll();
    const hrMax = hrMaxFor(runs);
    const zones = Zones.hrZones(hrMax);
    const totals = zones.map(() => 0);
    const cutoff = Date.now() - 28 * 86400000;
    let counted = 0;

    runs.forEach((r) => {
      if (dayMs(r.date) < cutoff) return;
      // per-interval HR when present, else the run's average
      const parts = (r.intervals || []).filter((i) => i.durationSec > 0 && i.avgHr);
      const chunks = parts.length ? parts.map((i) => ({ sec: i.durationSec, hr: i.avgHr }))
        : (r.durationSec && r.avgHr ? [{ sec: r.durationSec, hr: r.avgHr }] : []);
      if (chunks.length) counted++;
      chunks.forEach((c) => {
        let zi = zones.findIndex((z) => c.hr <= z.hi);
        if (zi < 0) zi = zones.length - 1;
        totals[zi] += c.sec;
      });
    });

    const totalSec = totals.reduce((a, b) => a + b, 0);
    if (!totalSec) {
      el.zoneDistNote.textContent = "Log runs with heart rate to see your training intensity mix.";
      el.zoneDist.replaceChildren();
      return;
    }
    el.zoneDistNote.textContent = `Last 4 weeks · ${counted} run${counted === 1 ? "" : "s"} with HR · Max HR ${hrMax} bpm.`;
    Charts.stack(el.zoneDist, {
      segments: zones.map((z, i) => ({
        label: `${z.z} ${z.name} (${z.lo}–${z.hi} bpm)`,
        value: Math.round(totals[i]),
        color: ZONE_RAMP[i],
      })),
      fmt: (v) => Zones.fmtTime(v),
      tableCols: ["Zone", "BPM", "Time", "Share"],
      tableRows: zones.map((z, i) => [
        `${z.z} ${z.name}`, `${z.lo}–${z.hi}`, Zones.fmtTime(totals[i]),
        `${Math.round((totals[i] / totalSec) * 100)}%`,
      ]),
    });
  }

  /* ---------- personal records ---------- */
  function renderPRs() {
    const runs = runsAll();
    const bests = Zones.bestEfforts(runs);
    el.emptyPr.classList.toggle("hidden", bests.length > 0);
    if (!bests.length) { el.prTable.innerHTML = ""; return; }
    el.prTable.replaceChildren();
    const trh = document.createElement("tr");
    ["Distance", "Time", "Pace", "Set on"].forEach((h) => {
      const th = document.createElement("th"); th.textContent = h; trh.appendChild(th);
    });
    el.prTable.appendChild(trh);
    const cutoff = isoOf(new Date(Date.now() - 28 * 86400000));
    bests.forEach((b) => {
      const tr = document.createElement("tr");
      const cells = [b.label, Zones.fmtTime(b.sec), Zones.fmtPace(b.pace), b.run?.date || "—"];
      cells.forEach((c, i) => {
        const td = document.createElement("td");
        if (i === 1) { const bEl = document.createElement("b"); bEl.textContent = c; td.appendChild(bEl); }
        else td.textContent = c;
        if (i === 3 && b.run?.date >= cutoff) {
          const badge = document.createElement("span");
          badge.className = "pr-badge"; badge.textContent = "new";
          td.appendChild(badge);
        }
        tr.appendChild(td);
      });
      el.prTable.appendChild(tr);
    });
  }

  function render() {
    renderTiles();
    renderEvolution();
    renderVolume();
    renderZoneDist();
    renderPRs();
  }

  function init() {
    el = {
      statGrid: document.getElementById("statGrid"),
      predChips: document.getElementById("predChips"),
      evoRange: document.getElementById("evoRange"),
      evoChart: document.getElementById("evoChart"),
      emptyEvo: document.getElementById("emptyEvo"),
      volChart: document.getElementById("volChart"),
      volNote: document.getElementById("volNote"),
      zoneDist: document.getElementById("zoneDist"),
      zoneDistNote: document.getElementById("zoneDistNote"),
      prTable: document.getElementById("prTable"),
      emptyPr: document.getElementById("emptyPr"),
    };
    // one chip per race distance; single-select
    Zones.TARGETS.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (t.label === target ? " is-active" : "");
      b.dataset.t = t.label;
      b.textContent = t.label;
      b.addEventListener("click", () => { target = t.label; renderTiles(); renderEvolution(); });
      el.predChips.appendChild(b);
    });
    // display-window chips for the trend chart
    RANGES.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (r.days === rangeDays ? " is-active" : "");
      b.dataset.days = String(r.days);
      b.textContent = r.label;
      b.addEventListener("click", () => { rangeDays = r.days; renderEvolution(); });
      el.evoRange.appendChild(b);
    });
    document.addEventListener("settings-changed", () => { if (visible()) render(); });
    document.addEventListener("data-applied", () => { if (visible()) render(); });
  }
  function visible() {
    const p = document.getElementById("runProgress");
    return p && !p.classList.contains("hidden") && p.offsetParent !== null;
  }

  return { init, render };
})();
