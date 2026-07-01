/* GPX parsing: turn a watch export (Zepp, Garmin, Strava, …) into the app's
   run shape — distance (haversine), moving time, time-weighted heart rate from
   track-point extensions, and automatic 1-km splits with per-split HR.

   The GPX start timestamp becomes `gpxKey`, the duplicate guard: a file that
   was already imported (on any synced device) is recognized and skipped. */
const GPX = (() => {
  const PAUSE_GAP = 20;   // seconds between points beyond which the watch was paused

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
      return {
        lat: parseFloat(pt.getAttribute("lat")),
        lon: parseFloat(pt.getAttribute("lon")),
        time: t ? Date.parse(t.textContent) : NaN,
        hr: hrOf(pt),
      };
    }).filter((p) => isFinite(p.lat) && isFinite(p.lon) && isFinite(p.time));
    if (pts.length < 2) throw new Error("No timed track points in this GPX.");

    const nameEl = doc.querySelector("trk > name") || doc.querySelector("metadata > name");
    const start = new Date(pts[0].time);

    let dist = 0, moving = 0, hrSum = 0, hrTime = 0, maxHr = 0;
    const intervals = [];
    let seg = { dist: 0, sec: 0, hrSum: 0, hrTime: 0 };   // current 1-km split

    function closeSplit(kmLen) {
      intervals.push({
        label: `km ${intervals.length + 1}`,
        distanceKm: +kmLen.toFixed(3),
        durationSec: Math.round(seg.sec),
        avgHr: seg.hrTime ? Math.round(seg.hrSum / seg.hrTime) : null,
        paceSecPerKm: kmLen > 0 ? Math.round(seg.sec / kmLen) : null,
      });
      seg = { dist: 0, sec: 0, hrSum: 0, hrTime: 0 };
    }

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      let d = haversine(a.lat, a.lon, b.lat, b.lon);
      let dt = (b.time - a.time) / 1000;
      if (dt <= 0) continue;
      if (dt > PAUSE_GAP) { dt = 0; d = 0; }   // paused — no time, no distance
      const hr = b.hr ?? a.hr;
      if (hr) { hrSum += hr * dt; hrTime += dt; maxHr = Math.max(maxHr, hr); }

      // walk this leg, splitting at every 1-km boundary (interpolated)
      let legD = d, legT = dt;
      while (seg.dist + legD >= 1000) {
        const need = 1000 - seg.dist;
        const f = legD > 0 ? need / legD : 0;
        seg.dist += need; seg.sec += legT * f;
        if (hr) { seg.hrSum += hr * legT * f; seg.hrTime += legT * f; }
        legD -= need; legT -= legT * f;
        closeSplit(1);
      }
      seg.dist += legD; seg.sec += legT;
      if (hr) { seg.hrSum += hr * legT; seg.hrTime += legT; }
      dist += d; moving += dt;
    }
    if (seg.dist > 150) closeSplit(seg.dist / 1000);   // final partial split

    if (dist < 100 || moving < 30) throw new Error("Track too short to import.");
    return {
      gpxKey: start.toISOString().slice(0, 19),
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      title: (nameEl && nameEl.textContent.trim()) || "Run",
      distanceKm: +(dist / 1000).toFixed(2),
      durationSec: Math.round(moving),
      avgHr: hrTime ? Math.round(hrSum / hrTime) : null,
      maxHr: maxHr || null,
      intervals,
      notes: "",
    };
  }

  return { parse };
})();
