/* Pure running math: pace formatting, best-effort segment analysis (from
   splits), effort classification (from HR), HR/pace zones, and Riegel race
   predictions anchored on the best *hard* effort rather than the run total. */
const Zones = (() => {
  const RIEGEL = 1.06;

  // ---- formatting ----
  function fmtTime(sec) {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function fmtPace(secPerKm) {
    if (!secPerKm || !isFinite(secPerKm)) return "—";
    const total = Math.round(secPerKm); // round first so 59.6 → 4:00, not 3:60
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}/km`;
  }
  function parseTime(str) {
    if (!str) return 0;
    const parts = String(str).trim().split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  // ---- effort from heart rate ----
  // fraction of max HR → label. null when HR unknown.
  function effortLabel(frac) {
    if (frac == null) return "—";
    if (frac >= 0.95) return "Max";
    if (frac >= 0.90) return "Hard";
    if (frac >= 0.82) return "Tempo";
    if (frac >= 0.72) return "Moderate";
    return "Easy";
  }
  const HARD_FRAC = 0.90; // at/above this we treat an effort as ~race intensity

  // ---- best-effort segments within a run ----
  // Standard distances we scan for (km).
  const SEG_TARGETS = [
    { label: "1 km", km: 1 },
    { label: "1 mile", km: 1.609344 },
    { label: "2 km", km: 2 },
    { label: "5 km", km: 5 },
    { label: "10 km", km: 10 },
    { label: "15 km", km: 15 },
    { label: "Half", km: 21.0975 },
  ];

  // Turn a run into ordered laps; fall back to one whole-run "lap".
  // With adjusted=true, grade-adjusted (flat-equivalent) times are used when
  // the import computed them — for the prediction models. PRs use real times.
  function lapsOf(run, adjusted = true) {
    const ivs = (run.intervals || []).filter((i) => i.distanceKm > 0 && i.durationSec > 0);
    if (ivs.length) return ivs.map((i) => ({ d: i.distanceKm, t: (adjusted && i.gapDurationSec) || i.durationSec, h: i.avgHr || null }));
    if (run.distanceKm > 0 && run.durationSec > 0)
      return [{ d: run.distanceKm, t: (adjusted && run.gapDurationSec) || run.durationSec, h: run.avgHr || null }];
    return [];
  }

  // Fastest contiguous window covering >= target distance, normalized to the
  // exact target; HR is the time-weighted average over the window.
  function fastestForTarget(laps, target) {
    const total = laps.reduce((a, l) => a + l.d, 0);
    if (target > total + 1e-6) return null;
    let best = null;
    for (let i = 0; i < laps.length; i++) {
      let dist = 0, time = 0, hrSum = 0, hrTime = 0;
      for (let j = i; j < laps.length; j++) {
        dist += laps[j].d; time += laps[j].t;
        if (laps[j].h) { hrSum += laps[j].h * laps[j].t; hrTime += laps[j].t; }
        if (dist >= target - 1e-6) {
          const sec = time * (target / dist);          // normalize to exact target
          if (!best || sec < best.sec) {
            best = { sec, hr: hrTime ? Math.round(hrSum / hrTime) : null };
          }
        }
      }
    }
    return best;
  }

  // Across all runs: the fastest segment for each standard distance.
  // Returns [{label, km, sec, pace, hr, run}], only distances the data supports.
  // whole-run normalized to a target distance (so sparse/partial splits don't
  // hide the overall effort)
  function wholeSeg(run, target, adjusted = true) {
    const t = (adjusted && run.gapDurationSec) || run.durationSec;
    if (run.distanceKm >= target - 1e-6 && t > 0)
      return { sec: t * (target / run.distanceKm), hr: run.avgHr || null };
    return null;
  }

  // opts.adjusted=false → real times (PRs); default true → grade-adjusted
  // (prediction input). Runs imported from GPX carry exact point-level bests
  // (run.bests) — preferred over the km-split window approximation.
  function bestEfforts(runs, opts = {}) {
    const adjusted = opts.adjusted !== false;
    const out = [];
    for (const tgt of SEG_TARGETS) {
      let best = null;
      for (const run of runs) {
        const stored = (run.bests || []).find((b) => Math.abs(b.km - tgt.km) < 0.01);
        const candidates = stored
          ? [{ sec: (adjusted && stored.gapSec) || stored.sec, hr: stored.hr }]
          : [fastestForTarget(lapsOf(run, adjusted), tgt.km), wholeSeg(run, tgt.km, adjusted)].filter(Boolean);
        for (const seg of candidates) {
          if (!best || seg.sec < best.sec) {
            best = { label: tgt.label, km: tgt.km, sec: seg.sec, pace: seg.sec / tgt.km, hr: seg.hr, run };
          }
        }
      }
      if (best) out.push(best);
    }
    return out;
  }

  // Choose the prediction anchor: prefer hard efforts (HR ≥ HARD_FRAC·maxHR,
  // or unknown HR), then the longest such effort (most reliable for long
  // predictions). Returns { anchor, hard, frac }.
  function pickAnchor(bests, hrMax) {
    if (!bests.length) return null;
    const scored = bests.map((b) => ({ ...b, frac: b.hr && hrMax ? b.hr / hrMax : null }));
    const hard = scored.filter((b) => b.frac == null || b.frac >= HARD_FRAC);
    const pool = hard.length ? hard : scored;
    pool.sort((a, b) => b.km - a.km); // longest first
    const anchor = pool[0];
    return { anchor, hard: hard.length > 0, frac: anchor.frac };
  }

  // ---- HR zones (5-zone %HRmax) ----
  const HR_BANDS = [
    { z: "Z1", name: "Recovery", lo: 0.50, hi: 0.60 },
    { z: "Z2", name: "Endurance", lo: 0.60, hi: 0.70 },
    { z: "Z3", name: "Tempo", lo: 0.70, hi: 0.80 },
    { z: "Z4", name: "Threshold", lo: 0.80, hi: 0.90 },
    { z: "Z5", name: "VO₂max", lo: 0.90, hi: 1.00 },
  ];
  function hrZones(hrMax) {
    return HR_BANDS.map((b) => ({
      z: b.z, name: b.name, lo: Math.round(b.lo * hrMax), hi: Math.round(b.hi * hrMax),
    }));
  }

  // ---- pace zones (multiples of threshold speed) ----
  const PACE_BANDS = [
    { z: "Z1", name: "Easy", lo: 0.78, hi: 0.88 },
    { z: "Z2", name: "Endurance", lo: 0.88, hi: 0.94 },
    { z: "Z3", name: "Tempo", lo: 0.94, hi: 1.00 },
    { z: "Z4", name: "Threshold", lo: 1.00, hi: 1.05 },
    { z: "Z5", name: "Interval", lo: 1.05, hi: 1.15 },
  ];
  function paceZones(thresholdPace) {
    const vt = 1 / thresholdPace;
    return PACE_BANDS.map((b) => ({
      z: b.z, name: b.name, slow: 1 / (b.lo * vt), fast: 1 / (b.hi * vt),
    }));
  }

  // ---- HR effort correction ----
  // Expected %HRmax for an ALL-OUT race effort of the given duration (seconds).
  // Anchored on observed race intensities: ~5k 97%, 10k 94%, HM 93%, M 87%.
  function expectedMaxHRpct(t) {
    const pts = [[60, 1.00], [90, 0.995], [1500, 0.97], [2700, 0.94], [5400, 0.93], [12600, 0.87], [20000, 0.85]];
    const lt = Math.log(Math.max(30, t));
    for (let i = 0; i < pts.length - 1; i++) {
      const [t1, h1] = pts[i], [t2, h2] = pts[i + 1];
      if (lt <= Math.log(t2) || i === pts.length - 2) {
        const a = Math.max(0, Math.min(1, (lt - Math.log(t1)) / (Math.log(t2) - Math.log(t1))));
        return h1 + (h2 - h1) * a;
      }
    }
    return 0.85;
  }
  // Scale a sub-maximal effort to its estimated max-effort time. velocity ∝
  // %VO2max (Swain), so corrected time = time · (%VO2_now / %VO2_max).
  function effortCorrect(sec, avgHr, hrMax) {
    if (!avgHr || !hrMax) return { sec, corrected: false };
    const pctNow = avgHr / hrMax;
    const pctMax = expectedMaxHRpct(sec);
    if (pctNow >= pctMax) return { sec, corrected: false }; // already ~maximal
    const vo2Now = (pctNow - 0.37) / 0.64;
    const vo2Max = (pctMax - 0.37) / 0.64;
    if (vo2Now <= 0 || vo2Max <= 0) return { sec, corrected: false };
    let factor = Math.max(0.85, vo2Now / vo2Max); // cap upscaling at ~+18% speed
    return { sec: sec * factor, corrected: true };
  }

  // ---- Critical Speed (2-parameter) ----
  // Fit distance = CS·time + D' over efforts at distinct distances.
  function fitCS(points) {
    const byDist = new Map();
    points.forEach((p) => { const k = Math.round(p.d); if (!byDist.has(k) || p.t < byDist.get(k).t) byDist.set(k, p); });
    const pts = [...byDist.values()];
    if (pts.length < 2) return null;
    const span = Math.max(...pts.map((p) => p.d)) / Math.min(...pts.map((p) => p.d));
    if (span < 1.8) return null; // need a meaningful distance range
    const n = pts.length;
    let st = 0, sd = 0, stt = 0, std = 0;
    pts.forEach((p) => { st += p.t; sd += p.d; stt += p.t * p.t; std += p.t * p.d; });
    const denom = n * stt - st * st;
    if (Math.abs(denom) < 1e-6) return null;
    const CS = (n * std - st * sd) / denom;     // m/s
    let Dp = (sd - CS * st) / n;                // m
    if (CS <= 0 || Dp < -50 || Dp > 600) return null;
    Dp = Math.max(0, Dp);
    return { CS, Dp, criticalPace: 1000 / CS }; // pace = sec/km
  }
  function predictCS(cs, distM) { return (distM - cs.Dp) / cs.CS; }

  // Full race-prediction pipeline: HR-correct efforts → Critical Speed (with
  // Riegel extrapolation beyond 10k) → fallback to Riegel from the best effort.
  function predictRaces(bests, hrMax) {
    if (!bests.length) return null;
    const pts = bests.map((b) => {
      const c = effortCorrect(b.sec, b.hr, hrMax);
      return { km: b.km, d: b.km * 1000, t: c.sec, corrected: c.corrected, label: b.label };
    });
    const corrected = pts.some((p) => p.corrected);
    const cs = fitCS(pts);
    let predictions, method;

    if (cs) {
      const cs10k = predictCS(cs, 10000) / 10; // 10k pace, for long-race Riegel
      predictions = TARGETS.map((r) => {
        const sec = r.km <= 12 ? predictCS(cs, r.km * 1000) : riegel(10, predictCS(cs, 10000), r.km);
        return { label: r.label, sec, pace: sec / r.km };
      });
      // sanity: times must increase with distance
      const ok = predictions.every((p, i) => i === 0 || p.sec > predictions[i - 1].sec) && predictions[0].sec > 0;
      if (ok) {
        method = "Critical Speed" + (corrected ? " · HR-adjusted" : "");
        return { method, cs, corrected, predictions };
      }
    }
    // fallback: Riegel from the longest corrected effort
    pts.sort((a, b) => b.km - a.km);
    const a = pts[0];
    predictions = TARGETS.map((r) => { const sec = riegel(a.km, a.t, r.km); return { label: r.label, sec, pace: sec / r.km }; });
    return { method: "Riegel" + (corrected ? " · HR-adjusted" : ""), cs: null, corrected, predictions, anchorKm: a.km };
  }

  // ---- Riegel predictions ----
  function riegel(d1, t1, d2) { return t1 * Math.pow(d2 / d1, RIEGEL); }
  const TARGETS = [
    { label: "1 km", km: 1 }, { label: "1 mile", km: 1.609344 },
    { label: "5 km", km: 5 }, { label: "10 km", km: 10 },
    { label: "Half", km: 21.0975 }, { label: "Marathon", km: 42.195 },
  ];
  function predictions(d1, t1) {
    return TARGETS.map((t) => {
      const sec = riegel(d1, t1, t.km);
      return { label: t.label, km: t.km, sec, pace: sec / t.km };
    });
  }

  return {
    fmtTime, fmtPace, parseTime,
    effortLabel, HARD_FRAC,
    bestEfforts, pickAnchor, predictRaces,
    hrZones, paceZones, predictions, riegel, TARGETS,
  };
})();
