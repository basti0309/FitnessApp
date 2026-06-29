/* Pure running math: pace formatting, HR/pace zones, Riegel race predictions.
   All distances in km, all times in seconds, all paces in sec/km. */
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
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, "0")}/km`;
  }
  // parse "mm:ss" or "h:mm:ss" → seconds
  function parseTime(str) {
    if (!str) return 0;
    const parts = String(str).trim().split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
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
      z: b.z, name: b.name,
      lo: Math.round(b.lo * hrMax),
      hi: Math.round(b.hi * hrMax),
    }));
  }

  // ---- Pace zones (multiples of threshold speed) ----
  // Bands as fraction of threshold speed Vt (faster = higher multiple).
  const PACE_BANDS = [
    { z: "Z1", name: "Easy", lo: 0.78, hi: 0.88 },
    { z: "Z2", name: "Endurance", lo: 0.88, hi: 0.94 },
    { z: "Z3", name: "Tempo", lo: 0.94, hi: 1.00 },
    { z: "Z4", name: "Threshold", lo: 1.00, hi: 1.05 },
    { z: "Z5", name: "Interval", lo: 1.05, hi: 1.15 },
  ];
  // thresholdPace in sec/km → pace ranges per zone (slower..faster sec/km)
  function paceZones(thresholdPace) {
    const vt = 1 / thresholdPace; // km per sec
    return PACE_BANDS.map((b) => ({
      z: b.z, name: b.name,
      slow: 1 / (b.lo * vt), // slower bound (bigger sec/km)
      fast: 1 / (b.hi * vt), // faster bound (smaller sec/km)
    }));
  }

  // ---- Riegel predictions ----
  // predict time (sec) for distance d2 given a baseline (d1 km, t1 sec)
  function riegel(d1, t1, d2) {
    return t1 * Math.pow(d2 / d1, RIEGEL);
  }
  const TARGETS = [
    { label: "1 km", km: 1 },
    { label: "1 mile", km: 1.609344 },
    { label: "5 km", km: 5 },
    { label: "10 km", km: 10 },
    { label: "Half", km: 21.0975 },
    { label: "Marathon", km: 42.195 },
  ];
  function predictions(d1, t1) {
    return TARGETS.map((t) => {
      const sec = riegel(d1, t1, t.km);
      return { label: t.label, km: t.km, sec, pace: sec / t.km };
    });
  }

  // Pick the run that implies the best shape: lowest Riegel-predicted 5k time.
  // runs: [{distanceKm, durationSec, ...}]
  function bestEffort(runs) {
    const valid = runs.filter((r) => r.distanceKm > 0.4 && r.durationSec > 0);
    if (!valid.length) return null;
    let best = null, bestScore = Infinity;
    for (const r of valid) {
      const score = riegel(r.distanceKm, r.durationSec, 5); // predicted 5k
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  return {
    fmtTime, fmtPace, parseTime,
    hrZones, paceZones, predictions, bestEffort, riegel, TARGETS,
  };
})();
