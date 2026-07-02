/* GPX parsing: turn a watch export (Zepp, Garmin, Strava, …) into the app's
   run shape — distance (haversine), moving time, time-weighted heart rate from
   track-point extensions, automatic 1-km splits with per-split HR, and
   grade-adjusted pace (GAP).

   GAP uses the Minetti et al. (2002) energy-cost-of-running polynomial
   C(i) [J/kg/m] over gradient i — the standard model behind Strava's GAP:
   running a slope at speed v costs C(i)·v; the equivalent flat speed with the
   same metabolic rate is v·C(i)/C(0), so each leg's flat-equivalent time is
   t·C(0)/C(i). Elevation is smoothed first to keep GPS noise out of i.

   The GPX start timestamp becomes `gpxKey`, the duplicate guard: a file that
   was already imported (on any synced device) is recognized and skipped. */
const GPX = (() => {
  const PAUSE_GAP = 20;   // seconds between points beyond which the watch was paused

  // Minetti 2002 cost of running, gradient clamped to the validated range
  function minettiC(i) {
    i = Math.max(-0.35, Math.min(0.35, i));
    return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i * i + 19.5 * i + 3.6;
  }
  const C0 = 3.6;

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // heart rate lives in namespaced extensions (gpxtpx:hr, ns3:hr, hr, …)
  function hrOf(pt) {
    const els = pt.getElementsByTagName("*");
    for (const e of els) {
      const n = (e.localName || "").toLowerCase();
      if (n === "hr" || n === "heartrate") {
        const v = parseInt(e.textContent, 10);
        if (v > 20 && v < 250) return v;
      }
    }
    return null;
  }

  function parse(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Not a valid GPX file.");
    const pts = [...doc.getElementsByTagName("trkpt")].map((pt) => {
      const t = pt.getElementsByTagName("time")[0];
      const e = pt.getElementsByTagName("ele")[0];
      return {
        lat: parseFloat(pt.getAttribute("lat")),
        lon: parseFloat(pt.getAttribute("lon")),
        time: t ? Date.parse(t.textContent) : NaN,
        ele: e ? parseFloat(e.textContent) : NaN,
        hr: hrOf(pt),
      };
    }).filter((p) => isFinite(p.lat) && isFinite(p.lon) && isFinite(p.time));
    if (pts.length < 2) throw new Error("No timed track points in this GPX.");

    // smooth elevation (moving average, ~±10 s) so GPS jitter doesn't fake slopes
    const hasEle = pts.filter((p) => isFinite(p.ele)).length > pts.length * 0.8;
    if (hasEle) {
      const raw = pts.map((p) => p.ele);
      const W = 10;
      pts.forEach((p, i) => {
        let s = 0, n = 0;
        for (let k = Math.max(0, i - W); k <= Math.min(pts.length - 1, i + W); k++) {
          if (isFinite(raw[k])) { s += raw[k]; n++; }
        }
        p.sEle = n ? s / n : NaN;
      });
    }

    const nameEl = doc.querySelector("trk > name") || doc.querySelector("metadata > name");
    const start = new Date(pts[0].time);

    // pass 1: legs with pause handling + cumulative distance per point
    const legs = [];                 // { d, dt, hr, a, b } (a/b = point indices)
    const cum = new Array(pts.length).fill(0);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      let d = haversine(a.lat, a.lon, b.lat, b.lon);
      let dt = (b.time - a.time) / 1000;
      if (dt <= 0) { cum[i] = cum[i - 1]; continue; }
      if (dt > PAUSE_GAP) { dt = 0; d = 0; }   // paused — no time, no distance
      cum[i] = cum[i - 1] + d;
      legs.push({ d, dt, hr: b.hr ?? a.hr, a: i - 1, b: i });
    }

    // Barometer/GPS elevation wobbles ±1–2 m constantly; fed raw into the
    // asymmetric Minetti curve that noise becomes a systematic GAP bias.
    // So grades come from a hysteresis-filtered profile: elevation anchors are
    // committed only when the (pre-smoothed) elevation moves ≥3 m away from
    // the last anchor, linear in between — real climbs survive at full size,
    // jitter vanishes (a flat run yields a flat profile and GAP ≈ pace).
    const anchors = [];   // { x: cum distance, e: elevation }
    let gain = 0, loss = 0;
    if (hasEle) {
      let ref = null;
      for (let i = 0; i < pts.length; i++) {
        if (!isFinite(pts[i].sEle)) continue;
        if (ref === null) { ref = { x: cum[i], e: pts[i].sEle }; anchors.push(ref); continue; }
        const dEle = pts[i].sEle - ref.e;
        if (Math.abs(dEle) >= 3) {
          ref = { x: cum[i], e: pts[i].sEle };
          anchors.push(ref);
          if (dEle > 0) gain += dEle; else loss -= dEle;
        }
      }
      const last = pts.length - 1;
      if (ref && isFinite(pts[last].sEle) && cum[last] > ref.x)
        anchors.push({ x: cum[last], e: pts[last].sEle });
    }
    function eleAt(x) {
      if (!anchors.length) return 0;
      let lo = 0, hi = anchors.length - 1;
      if (x <= anchors[0].x) return anchors[0].e;
      if (x >= anchors[hi].x) return anchors[hi].e;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; (anchors[m].x <= x ? lo = m : hi = m); }
      const a = anchors[lo], b = anchors[hi];
      return a.e + ((b.e - a.e) * (x - a.x)) / Math.max(1, b.x - a.x);
    }
    const GRADE_WIN = 25; // m each side → grade over ~50 m of the filtered profile
    function gradeAt(mid) {
      return (eleAt(mid + GRADE_WIN) - eleAt(mid - GRADE_WIN)) / (2 * GRADE_WIN);
    }

    // pass 2: totals + 1-km splits (with flat-equivalent GAP time per leg)
    let dist = 0, moving = 0, gapTotal = 0, hrSum = 0, hrTime = 0, maxHr = 0;
    const intervals = [];
    let seg = { dist: 0, sec: 0, gap: 0, hrSum: 0, hrTime: 0 };

    function closeSplit(kmLen) {
      intervals.push({
        label: `km ${intervals.length + 1}`,
        distanceKm: +kmLen.toFixed(3),
        durationSec: Math.round(seg.sec),
        gapDurationSec: hasEle ? Math.round(seg.gap) : null,
        avgHr: seg.hrTime ? Math.round(seg.hrSum / seg.hrTime) : null,
        paceSecPerKm: kmLen > 0 ? Math.round(seg.sec / kmLen) : null,
      });
      seg = { dist: 0, sec: 0, gap: 0, hrSum: 0, hrTime: 0 };
    }

    for (const leg of legs) {
      const { d, dt, hr } = leg;
      if (hr && dt) { hrSum += hr * dt; hrTime += dt; maxHr = Math.max(maxHr, hr); }

      let gapT = dt;
      if (hasEle && dt > 0 && d > 0.5) {
        gapT = dt * C0 / minettiC(gradeAt((cum[leg.a] + cum[leg.b]) / 2));
      }
      leg.gapT = gapT;

      // walk this leg, splitting at every 1-km boundary (interpolated)
      let legD = d, legT = dt, legG = gapT;
      while (seg.dist + legD >= 1000) {
        const need = 1000 - seg.dist;
        const f = legD > 0 ? need / legD : 0;
        seg.dist += need; seg.sec += legT * f; seg.gap += legG * f;
        if (hr) { seg.hrSum += hr * legT * f; seg.hrTime += legT * f; }
        legD -= need; legT -= legT * f; legG -= legG * f;
        closeSplit(1);
      }
      seg.dist += legD; seg.sec += legT; seg.gap += legG;
      if (hr) { seg.hrSum += hr * legT; seg.hrTime += legT; }
      dist += d; moving += dt; gapTotal += gapT;
    }
    if (seg.dist > 150) closeSplit(seg.dist / 1000);   // final partial split

    // exact best efforts from the raw points (not km-split-aligned): a fast
    // 5k starting anywhere inside the run is found by a sliding window over
    // cumulative distance/time. Real time for PRs, GAP time for predictions.
    const cumT = new Array(pts.length).fill(0);   // moving seconds
    const cumG = new Array(pts.length).fill(0);   // grade-adjusted seconds
    const cumH = new Array(pts.length).fill(0);   // Σ hr·dt
    const cumHT = new Array(pts.length).fill(0);  // Σ dt with hr
    {
      let li = 0;
      for (let i = 1; i < pts.length; i++) {
        cumT[i] = cumT[i - 1]; cumG[i] = cumG[i - 1];
        cumH[i] = cumH[i - 1]; cumHT[i] = cumHT[i - 1];
        if (li < legs.length && legs[li].b === i) {
          const lg = legs[li++];
          cumT[i] += lg.dt; cumG[i] += lg.gapT ?? lg.dt;
          if (lg.hr && lg.dt) { cumH[i] += lg.hr * lg.dt; cumHT[i] += lg.dt; }
        }
      }
    }
    const BEST_TARGETS = [
      { label: "1 km", m: 1000 }, { label: "1 mile", m: 1609.344 },
      { label: "2 km", m: 2000 }, { label: "5 km", m: 5000 },
      { label: "10 km", m: 10000 }, { label: "15 km", m: 15000 },
      { label: "Half", m: 21097.5 },
    ];
    const bests = [];
    const N = pts.length - 1;
    for (const tgt of BEST_TARGETS) {
      if (cum[N] < tgt.m) break;
      let best = null, i = 0;
      for (let j = 1; j <= N; j++) {
        while (cum[j] - cum[i + 1] >= tgt.m) i++;   // tightest window ≥ target
        const d = cum[j] - cum[i];
        if (d < tgt.m) continue;
        const t = (cumT[j] - cumT[i]) * (tgt.m / d); // normalize to exact target
        if (t > 0 && (!best || t < best.sec)) {
          const hrT = cumHT[j] - cumHT[i];
          best = {
            sec: t,
            gapSec: (cumG[j] - cumG[i]) * (tgt.m / d),
            hr: hrT > 0 ? (cumH[j] - cumH[i]) / hrT : null,
          };
        }
      }
      if (best) bests.push({
        label: tgt.label, km: tgt.m / 1000,
        sec: Math.round(best.sec),
        gapSec: hasEle ? Math.round(best.gapSec) : null,
        hr: best.hr ? Math.round(best.hr) : null,
      });
    }

    if (dist < 100 || moving < 30) throw new Error("Track too short to import.");
    return {
      gpxKey: start.toISOString().slice(0, 19),
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      title: (nameEl && nameEl.textContent.trim()) || "Run",
      distanceKm: +(dist / 1000).toFixed(2),
      durationSec: Math.round(moving),
      gapDurationSec: hasEle ? Math.round(gapTotal) : null,
      elevGainM: hasEle ? Math.round(gain) : null,
      elevLossM: hasEle ? Math.round(loss) : null,
      avgHr: hrTime ? Math.round(hrSum / hrTime) : null,
      maxHr: maxHr || null,
      intervals,
      bests,
      notes: "",
    };
  }

  return { parse };
})();
