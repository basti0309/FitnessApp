/* Tiny dependency-free SVG charts for the dark theme.
   Marks follow the house chart rules: 2px lines, ≥8px markers with a surface
   ring, bars ≤24px with rounded data-ends, hairline solid grid, hover layer
   with crosshair/tooltip, and a table twin so no value is color- or
   hover-gated. Colors are passed in (validated palette), text uses ink tokens. */
const Charts = (() => {
  const SURFACE = "var(--bg-card)";
  const INK = "var(--txt)";
  const MUTED = "var(--muted)";
  const GRID = "var(--line)";

  // re-draw registry so charts stay crisp on rotate / resize
  const REG = new Map(); // host -> draw()
  let wired = false;
  function mount(host, draw) {
    REG.set(host, draw);
    if (!wired) {
      wired = true;
      let t;
      window.addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(() => REG.forEach((d, h) => { if (h.isConnected && h.offsetParent) d(); }), 150);
      });
    }
    draw();
  }

  function S(tag, attrs = {}) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function div(cls) { const d = document.createElement("div"); if (cls) d.className = cls; return d; }
  function txt(el, s) { el.textContent = s; return el; }

  // nice ticks for plain numbers (km, counts)
  function niceTicks(min, max, want = 4) {
    if (max <= min) max = min + 1;
    const raw = (max - min) / want;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (max - min) / s <= want + 1) || 10 * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }
  // nice ticks for durations in seconds
  const TSTEPS = [5, 10, 15, 30, 60, 90, 120, 180, 300, 600, 900, 1800, 3600, 7200];
  function niceTimeTicks(min, max, want = 4) {
    if (max <= min) max = min + 30;
    const step = TSTEPS.find((s) => (max - min) / s <= want + 1) || 7200;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
    return ticks;
  }

  function shortDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // tooltip helper (one per chart wrapper)
  function makeTip(wrap) {
    const tip = div("chart-tip");
    tip.hidden = true;
    wrap.appendChild(tip);
    return {
      show(rows, px, py) {
        tip.replaceChildren();
        rows.forEach((r) => {
          const row = div("chart-tip-row");
          if (r.color) { const k = div("chart-tip-key"); k.style.background = r.color; row.appendChild(k); }
          const v = txt(div("chart-tip-val"), r.value);
          const l = txt(div("chart-tip-label"), r.label);
          row.appendChild(v); row.appendChild(l);
          tip.appendChild(row);
        });
        tip.hidden = false;
        const w = wrap.clientWidth, tw = tip.offsetWidth;
        tip.style.left = Math.max(4, Math.min(px + 12, w - tw - 4)) + "px";
        tip.style.top = Math.max(2, py - tip.offsetHeight - 12) + "px";
      },
      hide() { tip.hidden = true; },
    };
  }

  // table twin: <details> under the chart, values always reachable
  function tableTwin(cols, rows) {
    const det = document.createElement("details");
    det.className = "chart-table";
    const sum = document.createElement("summary");
    sum.textContent = "View as table";
    det.appendChild(sum);
    const table = document.createElement("table");
    table.className = "ztable";
    const trh = document.createElement("tr");
    cols.forEach((c) => trh.appendChild(txt(document.createElement("th"), c)));
    table.appendChild(trh);
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      r.forEach((cell) => tr.appendChild(txt(document.createElement("td"), cell)));
      table.appendChild(tr);
    });
    det.appendChild(table);
    return det;
  }

  /* ---------------- line chart ----------------
     points: [{x: ms epoch, xLabel: iso date, y: seconds}], single series.
     yKind: "time" | "number". Lower-is-better is up to the caller's copy. */
  function line(host, opts) { mount(host, () => drawLine(host, opts)); }
  function drawLine(host, { points, color, yKind = "time", yFmt, seriesName = "", tableCols, tableRows }) {
    host.replaceChildren();
    if (!points || points.length === 0) return;
    const fmtY = yFmt || ((v) => (yKind === "time" ? Zones.fmtTime(v) : String(v)));

    const wrap = div("chart-wrap");
    host.appendChild(wrap);
    const W = Math.max(260, wrap.clientWidth || host.clientWidth || 480);
    const H = 200, padL = 52, padR = 16, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const ys = points.map((p) => p.y);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    const spread = Math.max(yMax - yMin, yKind === "time" ? 60 : 1);
    yMin -= spread * 0.15; yMax += spread * 0.15;
    const yTicks = (yKind === "time" ? niceTimeTicks : niceTicks)(yMin, yMax, 4);
    const xs = points.map((p) => p.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const X = (x) => padL + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
    const Y = (y) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: "0" });
    svg.setAttribute("aria-label", seriesName || "line chart");

    // grid + y ticks
    yTicks.forEach((t) => {
      svg.appendChild(S("line", { x1: padL, x2: W - padR, y1: Y(t), y2: Y(t), stroke: GRID, "stroke-width": 1 }));
      const lab = S("text", { x: padL - 8, y: Y(t) + 3.5, "text-anchor": "end", fill: MUTED, "font-size": 11 });
      lab.textContent = fmtY(t);
      svg.appendChild(lab);
    });
    // x ticks: up to 4 evenly-spaced points, deduped labels
    const idxs = [...new Set([0, Math.round((points.length - 1) / 3), Math.round((2 * (points.length - 1)) / 3), points.length - 1])];
    let lastLab = null;
    idxs.forEach((i) => {
      const p = points[i], lab = shortDate(p.xLabel);
      if (lab === lastLab) return;
      lastLab = lab;
      const t = S("text", { x: X(p.x), y: H - 8, "text-anchor": "middle", fill: MUTED, "font-size": 11 });
      t.textContent = lab;
      svg.appendChild(t);
    });

    // the line + markers (surface ring keeps dots legible on the line)
    const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    svg.appendChild(S("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    points.forEach((p) => {
      svg.appendChild(S("circle", { cx: X(p.x), cy: Y(p.y), r: 4, fill: color, stroke: SURFACE, "stroke-width": 2 }));
    });
    // direct label on the endpoint only
    const last = points[points.length - 1];
    const endLab = S("text", {
      x: Math.min(X(last.x), W - padR - 2), y: Math.max(12, Y(last.y) - 10),
      "text-anchor": "end", fill: INK, "font-size": 12, "font-weight": 700,
    });
    endLab.textContent = fmtY(last.y);
    svg.appendChild(endLab);

    // crosshair + tooltip: aim at a date, not at a 2px line
    const cross = S("line", { y1: padT, y2: padT + plotH, stroke: MUTED, "stroke-width": 1, opacity: 0 });
    svg.appendChild(cross);
    wrap.appendChild(svg);
    const tip = makeTip(wrap);
    let active = -1;
    function showIdx(i) {
      active = i;
      const p = points[i];
      cross.setAttribute("x1", X(p.x)); cross.setAttribute("x2", X(p.x));
      cross.setAttribute("opacity", 0.6);
      const scale = wrap.clientWidth / W || 1;
      tip.show(
        [{ color, value: fmtY(p.y), label: `${seriesName ? seriesName + " · " : ""}${shortDate(p.xLabel)}` }],
        X(p.x) * scale, Y(p.y) * scale
      );
    }
    function hide() { cross.setAttribute("opacity", 0); tip.hide(); active = -1; }
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W;
      let bi = 0, bd = Infinity;
      points.forEach((p, i) => { const d2 = Math.abs(X(p.x) - mx); if (d2 < bd) { bd = d2; bi = i; } });
      showIdx(bi);
    });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { showIdx(Math.min(points.length - 1, active < 0 ? 0 : active + 1)); e.preventDefault(); }
      if (e.key === "ArrowLeft") { showIdx(Math.max(0, active < 0 ? points.length - 1 : active - 1)); e.preventDefault(); }
      if (e.key === "Escape") hide();
    });
    svg.addEventListener("blur", hide);

    if (tableCols && tableRows) host.appendChild(tableTwin(tableCols, tableRows));
  }

  /* ---------------- column chart ----------------
     items: [{label, value, sub}], one series → one hue, no legend. */
  function bars(host, opts) { mount(host, () => drawBars(host, opts)); }
  function drawBars(host, { items, color, unit = "", fmt, tableCols, tableRows }) {
    host.replaceChildren();
    if (!items || !items.length) return;
    const f = fmt || ((v) => `${v}${unit}`);

    const wrap = div("chart-wrap");
    host.appendChild(wrap);
    const W = Math.max(260, wrap.clientWidth || host.clientWidth || 480);
    const H = 190, padL = 34, padR = 10, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const vMax = Math.max(...items.map((i) => i.value), 1);
    const ticks = niceTicks(0, vMax * 1.12, 3);
    const yTop = ticks[ticks.length - 1] > 0 ? Math.max(ticks[ticks.length - 1], vMax * 1.05) : vMax;
    const Y = (v) => padT + plotH - (v / yTop) * plotH;

    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
    ticks.forEach((t) => {
      svg.appendChild(S("line", { x1: padL, x2: W - padR, y1: Y(t), y2: Y(t), stroke: GRID, "stroke-width": 1 }));
      const lab = S("text", { x: padL - 6, y: Y(t) + 3.5, "text-anchor": "end", fill: MUTED, "font-size": 11 });
      lab.textContent = String(t);
      svg.appendChild(lab);
    });
    // baseline
    svg.appendChild(S("line", { x1: padL, x2: W - padR, y1: Y(0), y2: Y(0), stroke: MUTED, "stroke-width": 1, opacity: 0.6 }));

    const slot = plotW / items.length;
    const bw = Math.min(24, Math.max(6, slot - 8));
    const maxIdx = items.reduce((bi, it, i) => (it.value > items[bi].value ? i : bi), 0);

    wrap.appendChild(svg);
    const tip = makeTip(wrap);
    const rects = [];
    items.forEach((it, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = Math.max(0, ((it.value / yTop) * plotH));
      const x = cx - bw / 2, y = Y(it.value);
      if (it.value > 0) {
        const r = Math.min(4, h);
        // rounded data-end, square at the baseline
        const p = `M${x},${Y(0)} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${Y(0)} Z`;
        const bar = S("path", { d: p, fill: color });
        svg.appendChild(bar);
        rects.push(bar);
      } else rects.push(null);
      // x labels: every other when narrow, anchored on the last bar so the
      // final label never collides with its neighbor
      const show = items.length <= 8 || (items.length - 1 - i) % 2 === 0;
      if (show) {
        const lab = S("text", { x: cx, y: H - 8, "text-anchor": "middle", fill: MUTED, "font-size": 10.5 });
        lab.textContent = it.label;
        svg.appendChild(lab);
      }
      // direct label on the biggest bar only
      if (i === maxIdx && it.value > 0) {
        const cap = S("text", { x: cx, y: y - 6, "text-anchor": "middle", fill: INK, "font-size": 11.5, "font-weight": 700 });
        cap.textContent = f(it.value);
        svg.appendChild(cap);
      }
      // full-slot transparent hit target (bigger than the mark)
      const hit = S("rect", { x: padL + slot * i, y: padT, width: slot, height: plotH + padB, fill: "transparent" });
      hit.style.cursor = "default";
      const scale = () => wrap.clientWidth / W || 1;
      hit.addEventListener("pointermove", () => {
        rects.forEach((b, k) => b && b.setAttribute("opacity", k === i ? 1 : 0.55));
        tip.show([{ color, value: f(it.value), label: it.sub || it.label }], cx * scale(), y * scale());
      });
      hit.addEventListener("pointerleave", () => {
        rects.forEach((b) => b && b.setAttribute("opacity", 1));
        tip.hide();
      });
      svg.appendChild(hit);
    });

    if (tableCols && tableRows) host.appendChild(tableTwin(tableCols, tableRows));
  }

  /* ---------------- single stacked hbar (part-to-whole) ----------------
     segments: [{label, value, color, detail}] — legend rows carry the values,
     so identity is never color-alone. */
  function stack(host, opts) { mount(host, () => drawStack(host, opts)); }
  function drawStack(host, { segments, fmt, tableCols, tableRows }) {
    host.replaceChildren();
    const total = segments.reduce((a, s) => a + s.value, 0);
    if (!total) return;
    const f = fmt || ((v) => String(v));

    const wrap = div("chart-wrap");
    host.appendChild(wrap);
    const W = Math.max(260, wrap.clientWidth || host.clientWidth || 480);
    const H = 22, GAP = 2;
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
    const shown = segments.filter((s) => s.value > 0);
    const gaps = (shown.length - 1) * GAP;
    let x = 0;
    const tip = makeTip(wrap);
    shown.forEach((s, i) => {
      const w = ((W - gaps) * s.value) / total;
      const r = 6;
      const isFirst = i === 0, isLast = i === shown.length - 1;
      const seg = S("path", {
        d: roundSides(x, 0, w, H, isFirst ? r : 0, isLast ? r : 0),
        fill: s.color,
      });
      const px = x + w / 2;
      seg.addEventListener("pointermove", () => {
        seg.setAttribute("opacity", 0.85);
        tip.show([{ color: s.color, value: `${f(s.value)} · ${Math.round((s.value / total) * 100)}%`, label: s.label }],
          (px / W) * (wrap.clientWidth || W), 0);
      });
      seg.addEventListener("pointerleave", () => { seg.setAttribute("opacity", 1); tip.hide(); });
      svg.appendChild(seg);
      x += w + GAP;
    });
    wrap.appendChild(svg);

    const legend = div("stack-legend");
    segments.forEach((s) => {
      const row = div("stack-row");
      const sw = div("stack-swatch"); sw.style.background = s.color;
      row.appendChild(sw);
      row.appendChild(txt(div("stack-name"), s.label));
      row.appendChild(txt(div("stack-val"), s.value > 0 ? `${f(s.value)} · ${Math.round((s.value / total) * 100)}%` : "—"));
      legend.appendChild(row);
    });
    host.appendChild(legend);
    if (tableCols && tableRows) host.appendChild(tableTwin(tableCols, tableRows));
  }
  function roundSides(x, y, w, h, rl, rr) {
    rl = Math.min(rl, w / 2); rr = Math.min(rr, w / 2);
    return `M${x + rl},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} ` +
      `L${x + rl},${y + h} Q${x},${y + h} ${x},${y + h - rl} L${x},${y + rl} Q${x},${y} ${x + rl},${y} Z`;
  }

  /* ---------------- area profile (pace / HR over time) ----------------
     points: [{x: seconds, y: value|null}] — null breaks the area (pauses).
     yKind "pace" inverts (faster = higher) and formats mm:ss. */
  let gradSeq = 0;
  function area(host, opts) { mount(host, () => drawArea(host, opts)); }
  function drawArea(host, { points, color, yKind = "hr", seriesName = "", xMax }) {
    host.replaceChildren();
    const solid = points.filter((p) => p.y != null);
    if (solid.length < 2) return;
    const invert = yKind === "pace";
    const fmtY = yKind === "pace" ? (v) => Zones.fmtPace(v).replace("/km", "") : (v) => String(Math.round(v));

    const wrap = div("chart-wrap");
    host.appendChild(wrap);
    const W = Math.max(260, wrap.clientWidth || host.clientWidth || 480);
    const H = 168, padL = 46, padR = 12, padT = 12, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const ys = solid.map((p) => p.y);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    const spread = Math.max(yMax - yMin, yKind === "pace" ? 30 : 10);
    yMin -= spread * 0.12; yMax += spread * 0.12;
    const xmax = xMax || Math.max(...points.map((p) => p.x)) || 1;
    const X = (x) => padL + (x / xmax) * plotW;
    const Y = (v) => invert
      ? padT + ((v - yMin) / (yMax - yMin)) * plotH
      : padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const baseY = padT + plotH;

    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: "0" });
    svg.setAttribute("aria-label", seriesName || "profile");
    const gid = "grad" + (++gradSeq);
    const defs = S("defs");
    const lg = S("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(S("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.55 }));
    lg.appendChild(S("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0.04 }));
    defs.appendChild(lg); svg.appendChild(defs);

    // y grid + labels
    const yTicks = (yKind === "pace" ? niceTimeTicks : niceTicks)(yMin, yMax, 4);
    yTicks.forEach((tk) => {
      if (tk < yMin || tk > yMax) return;
      svg.appendChild(S("line", { x1: padL, x2: W - padR, y1: Y(tk), y2: Y(tk), stroke: GRID, "stroke-width": 1 }));
      const lab = S("text", { x: padL - 6, y: Y(tk) + 3.5, "text-anchor": "end", fill: MUTED, "font-size": 10.5 });
      lab.textContent = fmtY(tk);
      svg.appendChild(lab);
    });
    // x time labels
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const sec = f * xmax;
      const tx = S("text", { x: X(sec), y: H - 7, "text-anchor": f === 0 ? "start" : f === 1 ? "end" : "middle", fill: MUTED, "font-size": 10.5 });
      tx.textContent = Zones.fmtTime(sec);
      svg.appendChild(tx);
    });

    // filled area, broken at gaps (pauses)
    let seg = [];
    const flush = () => {
      if (seg.length > 1) {
        const top = seg.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
        svg.appendChild(S("path", { d: `${top} L${X(seg[seg.length - 1].x).toFixed(1)},${baseY} L${X(seg[0].x).toFixed(1)},${baseY} Z`, fill: `url(#${gid})` }));
        svg.appendChild(S("path", { d: top, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      }
      seg = [];
    };
    points.forEach((p) => { if (p.y == null) flush(); else seg.push(p); });
    flush();

    // crosshair + tooltip
    const cross = S("line", { y1: padT, y2: padT + plotH, stroke: MUTED, "stroke-width": 1, opacity: 0 });
    const dot = S("circle", { r: 4, fill: color, stroke: SURFACE, "stroke-width": 2, opacity: 0 });
    svg.appendChild(cross); svg.appendChild(dot);
    wrap.appendChild(svg);
    const tip = makeTip(wrap);
    function showAt(px) {
      let best = null, bd = Infinity;
      for (const p of solid) { const d = Math.abs(X(p.x) - px); if (d < bd) { bd = d; best = p; } }
      if (!best) return;
      cross.setAttribute("x1", X(best.x)); cross.setAttribute("x2", X(best.x)); cross.setAttribute("opacity", 0.6);
      dot.setAttribute("cx", X(best.x)); dot.setAttribute("cy", Y(best.y)); dot.setAttribute("opacity", 1);
      const scale = wrap.clientWidth / W || 1;
      tip.show([{ color, value: fmtY(best.y) + (yKind === "pace" ? "/km" : " bpm"), label: `${seriesName ? seriesName + " · " : ""}${Zones.fmtTime(best.x)}` }], X(best.x) * scale, Y(best.y) * scale);
    }
    function hide() { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); tip.hide(); }
    svg.addEventListener("pointermove", (e) => { const r = svg.getBoundingClientRect(); showAt(((e.clientX - r.left) / r.width) * W); });
    svg.addEventListener("pointerleave", hide);
  }

  return { line, bars, stack, area };
})();
