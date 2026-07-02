/* GPX parsing: turn a watch export (Zepp, Garmin, Strava, …) into the app's
   run shape — distance (haversine), moving time, time-weighted heart rate from
   track-point extensions, automatic 1-km splits with per-split HR, and
   grade-adjusted pace (GAP).

   GAP uses the Minetti et al. (2002) energy-cost-of-running polynomial
   C(i) [J/kg/m] over gradient i — the standard model behind Strava's GAP:
   running a slope at speed v costs C(i)·v; the equivalent flat speed with the
   same metabolic rate is v·C(i)/C(0), so each leg's flat-equivalent time is
   t·C(0)/C(i). Elevation is smoothed first to keep GPS noise out of i.

   Optical wrist-HR sensors often misread at the start of a run (a false spike,
   then — after a stop — a slow settle) before locking onto the true signal.
   cleanHR() detects that early "warm-up" window from the HR↔effort coupling
   and reconstructs it, so avg/max HR, per-split HR, zones, effort labels and
   the predictions all use trustworthy HR. Raw values are kept alongside.

   The GPX start timestamp becomes `gpxKey`, the duplicate guard: a file that
   was already imported (on any synced device) is recognized and skipped. */
const GPX = (() => {
  const PAUSE_GAP = 20;   // seconds between points beyond which the watch was paused

  function median(arr) {
    if (!arr.length) return NaN;
    const s = [...arr].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Gauss-Jordan for small systems (normalized pivot rows); null if singular.
  function solve(A, B) {
    const n = B.length, M = A.map((r, i) => [...r, B[i]]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      [M[col], M[piv]] = [M[piv], M[col]];
      const pv = M[col][col];
      for (let k = col; k <= n; k++) M[col][k] /= pv;      // normalize pivot row → diagonal 1
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
      }
    }
    return M.map((r) => r[n]);
  }
  // Fit HR = a + b·gapV (+ c·minutes when drift), robust to collinearity: on a
  // steady run gapV barely varies, so the full system is near-singular — we try
  // the full model, then drop terms until it solves, and always return a model.
  const HR_TERM = { a: () => 1, b: (p) => p.gapV, c: (p) => p.s / 60 };
  function fitHRModel(arr, drift) {
    if (arr.length < 3) return null;
    const specs = drift ? [["a", "b", "c"], ["a", "c"], ["a", "b"], ["a"]] : [["a", "b"], ["a"]];
    const build = (data, keys) => {
      const dim = keys.length;
      const A = Array.from({ length: dim }, () => Array(dim).fill(0)), B = Array(dim).fill(0);
      for (const p of data) {
        const x = keys.map((k) => HR_TERM[k](p));
        for (let i = 0; i < dim; i++) { B[i] += x[i] * p.hrH; for (let j = 0; j < dim; j++) A[i][j] += x[i] * x[j]; }
      }
      const co = solve(A, B);
      if (!co || co.some((x) => !isFinite(x))) return null;   // reject ill-conditioned
      const m = { a: 0, b: 0, c: 0, _keys: keys };
      keys.forEach((k, i) => { m[k] = co[i]; });
      return m;
    };
    let m = null, keys = null;
    for (const sp of specs) { m = build(arr, sp); if (m) { keys = sp; break; } }
    if (!m) return { a: median(arr.map((p) => p.hrH)), b: 0, c: 0 };
    for (let it = 0; it < 2; it++) {
      const kept = arr.filter((p) => Math.abs(p.hrH - (m.a + m.b * p.gapV + m.c * (p.s / 60))) < 15);
      if (kept.length > Math.max(10, arr.length * 0.5)) { const mm = build(kept, keys); if (mm) m = mm; }
    }
    return m;
  }

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
      if (dt < 0) { cum[i] = cum[i - 1]; continue; }   // backward clock — skip
      if (dt > PAUSE_GAP) { dt = 0; d = 0; }            // paused — no time, no distance
      // dt === 0 keeps its distance (watches log several fixes per second — the
      // movement between them is real; dropping it undercounts distance ~8% and
      // wrecks pace/best-efforts), but adds no time.
      cum[i] = cum[i - 1] + d;
      legs.push({ d, dt, a: i - 1, b: i });    // hr filled after HR cleaning
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

    // ---- HR cleaning: detect & reconstruct the early optical-sensor artifact ----
    // Sets pts[i].hrUse on every point. Returns fix info (or null if untouched).
    const hrFix = cleanHR(pts, cum, gradeAt);

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
      const { d, dt } = leg;
      const hr = pts[leg.b].hrUse ?? pts[leg.a].hrUse;   // cleaned HR
      leg.hr = hr;                                        // for the best-effort sweep
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
      if (best) {
        bests.push({
          label: tgt.label, km: tgt.m / 1000,
          sec: Math.round(best.sec),
          gapSec: hasEle ? Math.round(best.gapSec) : null,
          hr: best.hr ? Math.round(best.hr) : null,
        });
      }
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
      rawAvgHr: hrFix ? hrFix.rawAvg : null,
      rawMaxHr: hrFix ? hrFix.rawMax : null,
      hrFix: hrFix ? { corrected: true, windowSec: hrFix.startupSec, effort: hrFix.effort || null } : null,
      series: buildSeries(pts, cum),
      intervals,
      bests,
      notes: "",
    };
  }

  // Downsampled time series for the run-detail profile charts: ~180 samples of
  // { t(s), pace(sec/km), hr(corrected), hrRaw }. Pace is smoothed over ±12 s
  // and null during pauses. Kept small so it syncs cheaply via Drive.
  function buildSeries(pts, cum) {
    const n = pts.length;
    if (n < 4) return null;
    const t0 = pts[0].time;
    const s = (i) => (pts[i].time - t0) / 1000;
    const TARGET = 180, stride = Math.max(1, Math.floor(n / TARGET));
    const t = [], pace = [], hr = [], hrRaw = [];
    let hasHR = false, hasFix = false;
    for (let i = 0; i < n; i += stride) {
      // smoothed pace from a ±12 s window (cum excludes paused distance)
      let lo = i, hi = i;
      while (lo > 0 && s(i) - s(lo) < 12) lo--;
      while (hi < n - 1 && s(hi) - s(i) < 12) hi++;
      const dd = cum[hi] - cum[lo], dts = s(hi) - s(lo);
      const v = dts > 0 ? dd / dts : 0;
      const p = v > 0.6 ? Math.round(1000 / v) : null;     // sec/km, null when stopped
      t.push(Math.round(s(i)));
      pace.push(p != null ? Math.max(120, Math.min(1200, p)) : null);
      const hc = pts[i].hrUse, hraw = pts[i].hr;
      hr.push(isFinite(hc) ? Math.round(hc) : null);
      hrRaw.push(isFinite(hraw) ? Math.round(hraw) : null);
      if (isFinite(hraw)) hasHR = true;
      if (isFinite(hc) && isFinite(hraw) && Math.round(hc) !== Math.round(hraw)) hasFix = true;
    }
    if (!hasHR && pace.every((x) => x == null)) return null;
    return { t, pace, hr, hrRaw: hasFix ? hrRaw : null };
  }

  // Detect the early optical-HR "warm-up" artifact and reconstruct it.
  // The wrist sensor decouples from effort at the start (a false spike, then —
  // often after a stop — a slow settle) before locking on. We learn the runner's
  // HR↔effort relationship from the settled part of THIS run, flag the initial
  // window where measured HR departs from it (in either direction), and rebuild
  // that window from the effort model plus a physiological onset ramp. Isolated
  // spikes anywhere else are removed with a Hampel (median/MAD) filter.
  // Sets pts[i].hrUse; returns { startupSec, effort, rawAvg, rawMax } or null.
  // Two independent optical-HR artifacts are handled:
  //   A) start-up window — a false early reading before the sensor locks on
  //      (continuous runs only; the reconstruction learns from the settled tail);
  //   B) sustained-effort under-read — the sensor "locks low" during a hard push,
  //      reading a flat/low plateau that then jumps to the true value.
  function cleanHR(pts, cum, gradeAt) {
    pts.forEach((p) => { p.hrUse = p.hr; });
    const withHR = pts.filter((p) => isFinite(p.hr) && p.hr > 40);
    if (withHR.length < 30) return null;
    const t0 = pts[0].time;
    const T = (pts[pts.length - 1].time - t0) / 1000;

    // per-point second, speed (from neighbours), grade → flat-equivalent effort
    for (let i = 0; i < pts.length; i++) {
      const lo = Math.max(0, i - 1), hi = Math.min(pts.length - 1, i + 1);
      const dts = (pts[hi].time - pts[lo].time) / 1000;
      const v = dts > 0 ? (cum[hi] - cum[lo]) / dts : 0;
      pts[i].s = (pts[i].time - t0) / 1000;
      pts[i].moving = v > 0.6;
      pts[i].gapV = v > 0 ? v * (minettiC(gradeAt(cum[i])) / C0) : 0;
    }

    // Hampel despike on the raw series → hrH (isolated spikes removed everywhere)
    const K = 7;
    for (let i = 0; i < pts.length; i++) {
      if (!isFinite(pts[i].hr)) { pts[i].hrH = pts[i].hr; continue; }
      const win = [];
      for (let k = Math.max(0, i - K); k <= Math.min(pts.length - 1, i + K); k++)
        if (isFinite(pts[k].hr)) win.push(pts[k].hr);
      const med = median(win);
      const mad = 1.4826 * median(win.map((x) => Math.abs(x - med)));
      pts[i].hrH = (mad > 0 && Math.abs(pts[i].hr - med) > 3 * mad) ? med : pts[i].hr;
    }

    const rawMax = Math.max(...withHR.map((p) => p.hr));
    const movHRraw = pts.filter((p) => p.moving && isFinite(p.hr));
    const rawAvg = Math.round(movHRraw.reduce((s, p) => s + p.hr, 0) / movHRraw.length);

    // An interval/test session split by several long stops isn't one continuous
    // effort, so the start-up reconstruction (which learns from the settled tail
    // and extrapolates back) doesn't apply — it would rebuild legitimate data.
    // The effort under-read (B) still applies; it targets the hard block itself.
    let longPauses = 0;
    for (let i = 1; i < pts.length; i++)
      if ((pts[i].time - pts[i - 1].time) / 1000 > 60) longPauses++;
    const intervally = longPauses >= 2;

    // ---- A) start-up optical artifact (false early reading) ----------------
    let startupSec = 0;
    const mv = pts.filter((p) => p.moving && isFinite(p.hrH));
    if (!intervally && mv.length >= 20) {
      // reference model HR ≈ a + b·gapV + c·min fit on the RELIABLE TAIL only
      // (last 45 %, past any start-up artifact), then extrapolated backwards.
      // The drift term (c) matters: at a steady pace HR still climbs over a run.
      const tailStart = T * 0.55;
      let tail = mv.filter((p) => p.s >= tailStart);
      if (tail.length < 20) tail = mv;
      let rm = fitHRModel(tail, true);
      if (rm) {
        rm.c = Math.max(0, Math.min(1.2, rm.c));         // drift 0…1.2 bpm/min
        const evalM = (m, p) => m.a + m.b * p.gapV + m.c * (p.s / 60);
        // smoothed residual vs the reference (±15 s, moving)
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (!p.moving || !isFinite(p.hrH)) { p.rRes = 0; continue; }
          let s = 0, n = 0;
          for (let k = i; k >= 0 && p.s - pts[k].s <= 15; k--)
            if (pts[k].moving && isFinite(pts[k].hrH)) { s += pts[k].hrH - evalM(rm, pts[k]); n++; }
          for (let k = i + 1; k < pts.length && pts[k].s - p.s <= 15; k++)
            if (pts[k].moving && isFinite(pts[k].hrH)) { s += pts[k].hrH - evalM(rm, pts[k]); n++; }
          p.rRes = n ? s / n : 0;
        }
        // lock-in = start of the first ≥120 s stretch where HR tracks the
        // reference within ±6 bpm (moving pts; pauses bridged).
        const SETTLE = 6, SETTLE_DUR = 120, DECOUPLE = 12, MAXFRAC = 0.6;
        let streak = null, lock = null;
        for (const p of pts) {
          if (!p.moving || !isFinite(p.hrH)) continue;
          if (Math.abs(p.rRes) <= SETTLE) {
            if (streak == null) streak = p.s;
            if (p.s - streak >= SETTLE_DUR) { lock = streak; break; }
          } else streak = null;
        }
        if (lock == null) lock = 0;
        // trigger only for a real artifact: a sustained HR-too-HIGH excursion
        // (a spike/plateau the sensor invents), not the natural low first minute.
        const artifact = pts.some((p) => p.moving && p.s < lock && p.rRes > DECOUPLE);
        if (artifact && lock > 0 && lock <= T * MAXFRAC) {
          const nearLock = pts.filter((p) => p.moving && isFinite(p.hrH) && p.s >= lock && p.s < lock + 180).map((p) => p.hrH);
          const Hlock = nearLock.length ? median(nearLock) : evalM(rm, { gapV: rm.b ? median(tail.map((p) => p.gapV)) : 0, s: lock });
          const startFloor = Math.max(80, Math.round(Hlock - 32));
          const TAU = 30, ONSET = 60;
          for (const p of pts) {
            if (p.s >= lock) { p.hrUse = p.hrH; continue; } // keep despiked reliable HR
            let e = Math.min(evalM(rm, p), Hlock + 3);       // never above the settled entry
            if (p.s < ONSET) e = startFloor + (e - startFloor) * (1 - Math.exp(-p.s / TAU));
            p.hrUse = Math.round(Math.max(40, Math.min(210, Math.max(startFloor - 5, e))));
          }
          startupSec = Math.round(lock);
        }
      }
    }

    // ---- B) sustained-effort HR under-read ("lock-low" during a hard push) --
    // Optical sensors sometimes lock ~15–25 bpm low through a sustained hard
    // effort, reading a flat plateau that later jumps to the true value. The
    // tell-tale is a physiological impossibility: within ONE continuous block
    // the runner is at equal-or-FASTER pace early but at a LOWER heart rate than
    // later — faster running can't lower HR (net of drift), so the early HR is
    // under-read. We rebuild it as a first-order rise from the effort-onset HR
    // toward the effort's own sustained peak, LIFT-ONLY (never lower a real
    // reading) and only while still running hard, so recoveries/cool-down are
    // left untouched. Normal negative-split runs (higher HR because faster) and
    // easy runs (flat HR) don't match the signature and are left alone.
    const effort = effortUnderread(pts, cum);

    if (!startupSec && !effort) return null;
    return { startupSec, effort, rawAvg, rawMax };
  }

  // Detects & reconstructs the sustained-effort under-read; returns { from, to }
  // (seconds, the window actually lifted) or null. Anchors on the fastest
  // continuous hard effort (a distance window, so warm-up / recovery jog /
  // cool-down are excluded), reads p.s/p.gapV/p.moving/hrH (set by cleanHR) and
  // lifts p.hrUse in place.
  function effortUnderread(pts, cum) {
    const N = pts.length - 1;
    if (N < 20) return null;
    // segStart[k] = index that begins the current continuous stretch (a >45 s
    // gap starts a new one) — keeps the effort window within one stretch.
    const segStart = new Array(pts.length).fill(0);
    for (let k = 1; k < pts.length; k++)
      segStart[k] = ((pts[k].time - pts[k - 1].time) / 1000 > 45) ? k : segStart[k - 1];
    // fastest continuous window of ≥ target metres (tightest window, min time)
    const fastest = (target) => {
      if (cum[N] < target) return null;
      let best = null, i = 0;
      for (let j = 1; j <= N; j++) {
        while (cum[j] - cum[i + 1] >= target) i++;
        const s = Math.max(i, segStart[j]);
        if (cum[j] - cum[s] < target) continue;            // would cross a long stop
        const t = pts[j].s - pts[s].s;
        if (t > 0 && (!best || t < best.t)) best = { i: s, j, t };
      }
      return best;
    };
    const win = fastest(5000) || fastest(3000) || fastest(2000);
    if (!win) return null;
    const seg = [];
    for (let k = win.i; k <= win.j; k++)
      if (pts[k].moving && isFinite(pts[k].hrH)) seg.push(pts[k]);
    if (seg.length < 20) return null;
    const bt0 = seg[0].s, span = seg[seg.length - 1].s - bt0;
    if (span < 240) return null;
    const avg = (a, f) => a.reduce((s, p) => s + f(p), 0) / a.length;
    const early = seg.filter((p) => p.s - bt0 < span / 3);
    const late = seg.filter((p) => p.s - bt0 > 2 * span / 3);
    if (early.length < 5 || late.length < 5) return null;
    const eV = avg(early, (p) => p.gapV), lV = avg(late, (p) => p.gapV);
    const eH = avg(early, (p) => p.hrH), lH = avg(late, (p) => p.hrH);
    const onset = median(early.map((p) => p.hrH));
    const sorted = [...seg.map((p) => p.hrH)].sort((a, b) => a - b);
    const peak = sorted[Math.floor(0.95 * (sorted.length - 1))];   // sustained high
    // The under-read signature: within ONE continuous effort the late third is
    // NOT meaningfully faster than the early third (≤8 %), yet HR is far higher
    // (>18 bpm), AND the early HR sits implausibly low for the effort (≤86 % of
    // the effort's own sustained peak). A genuine negative split (late much
    // faster → HR earned) or normal cardiac drift (early HR already high) each
    // fail one of these, so only a true sensor lock-low triggers.
    if (!(lV <= eV * 1.08 && lH - eH > 18 && eH <= 0.86 * peak && peak - onset >= 20)) return null;
    // Rebuild across the whole effort window (warm-up / recovery jog / cool-down
    // are already outside it by construction), so a brief mid-effort pace dip
    // can't snap HR back to the suppressed plateau. LIFT-ONLY: a genuinely high
    // reading is never lowered.
    const TAU_E = 75;                                       // HR onset τ for a hard effort
    let from = null, to = null;
    for (let k = win.i; k <= win.j; k++) {
      const p = pts[k];
      if (!isFinite(p.hrH)) continue;
      const tgt = peak - (peak - onset) * Math.exp(-(p.s - bt0) / TAU_E);
      if (tgt > p.hrH + 1) {
        p.hrUse = Math.round(Math.min(210, tgt));
        if (from == null) from = p.s;
        to = p.s;
      }
    }
    return from == null ? null : { from: Math.round(from), to: Math.round(to) };
  }

  return { parse };
})();
