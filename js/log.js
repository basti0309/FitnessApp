/* WOD logging built around exercises (not names).

   A WOD = a structure (For Time rounds / AMRAP duration / Tabata intervals)
   plus an ordered list of exercises, each with reps and an optional weight.

   Two WODs are "the same" when their structure + exercises + reps match.
   Weight is logged but deliberately excluded from that comparison, so
   "Check previous results" can surface past scores regardless of the load used. */
const Log = (() => {
  let el = {};
  const TYPE_LABEL = { fortime: "For Time", amrap: "AMRAP", tabata: "Tabata" };

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  // ---------- reading the form ----------
  function readStruct(type) {
    if (type === "fortime") {
      return { rounds: parseInt(el.sRounds.value, 10) || 1 };
    }
    if (type === "amrap") {
      const sec = (parseInt(el.sAmrapMin.value, 10) || 0) * 60 + (parseInt(el.sAmrapSec.value, 10) || 0);
      return { durationSec: sec };
    }
    return {
      rounds: parseInt(el.sTabRounds.value, 10) || 1,
      workSec: parseInt(el.sTabWork.value, 10) || 0,
      restSec: parseInt(el.sTabRest.value, 10) || 0,
    };
  }

  function readExercises() {
    return [...el.exList.querySelectorAll(".ex-row")]
      .map((row) => ({
        name: row.querySelector(".ex-name").value.trim(),
        reps: row.querySelector(".ex-reps").value.trim(),
        weight: row.querySelector(".ex-weight").value.trim(),
      }))
      .filter((e) => e.name !== "");
  }

  function readResult(type) {
    if (type === "fortime") return el.rFortime.value.trim() || "—";
    if (type === "amrap") {
      const r = parseInt(el.rRounds.value, 10) || 0;
      const reps = parseInt(el.rReps.value, 10) || 0;
      return reps ? `${r} rounds + ${reps} reps` : `${r} rounds`;
    }
    return el.rTabata.value.trim() || "—";
  }

  // ---------- the WOD "identity" (weight excluded) ----------
  function signature(type, struct, exercises) {
    let head = type;
    if (type === "fortime") head += `|r${struct.rounds}`;
    else if (type === "amrap") head += `|d${struct.durationSec}`;
    else head += `|r${struct.rounds}w${struct.workSec}x${struct.restSec}`;
    const body = exercises
      .map((e) => `${e.name.trim().toLowerCase()}*${e.reps || ""}`)
      .join("+");
    return head + "||" + body;
  }

  function entrySignature(entry) {
    return signature(entry.type, entry.struct || {}, entry.exercises || []);
  }

  // ---------- pretty formatting ----------
  function fmtStruct(entry) {
    const s = entry.struct || {};
    if (entry.type === "fortime") return `${s.rounds || "?"} RFT`;
    if (entry.type === "amrap") {
      const sec = s.durationSec || 0;
      return `AMRAP ${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    }
    return `Tabata ${s.rounds || "?"}×(${s.workSec || 0}/${s.restSec || 0})`;
  }

  function fmtExercises(exercises, { withWeight = true } = {}) {
    return (exercises || [])
      .map((e) => {
        let t = e.reps ? `${e.reps} ${e.name}` : e.name;
        if (withWeight && e.weight) t += ` @${e.weight}`;
        return escape(t);
      })
      .join(" · ");
  }

  // ---------- check previous results ----------
  function checkPrevious() {
    const type = el.fType.value;
    const struct = readStruct(type);
    const exercises = readExercises();

    if (!exercises.length) {
      el.prevPanel.className = "prev-panel";
      el.prevPanel.innerHTML = `<p class="muted">Add at least one exercise first, then check.</p>`;
      return;
    }

    const sig = signature(type, struct, exercises);
    const matches = Store.all().filter((e) => entrySignature(e) === sig);

    if (!matches.length) {
      el.prevPanel.className = "prev-panel";
      el.prevPanel.innerHTML = `<p class="muted">No previous logs for this exact WOD yet — this one sets your baseline. 💪</p>`;
      return;
    }

    const rows = matches
      .map((e) => `
        <li>
          <div class="prev-top"><span class="prev-result">${escape(e.result)}</span><span class="prev-date">${fmtDate(e.date)}</span></div>
          <div class="prev-weights">${fmtExercises(e.exercises, { withWeight: true }) || "<span class='muted'>bodyweight</span>"}</div>
          ${e.notes ? `<div class="prev-notes">${escape(e.notes)}</div>` : ""}
        </li>`)
      .join("");

    el.prevPanel.className = "prev-panel show";
    el.prevPanel.innerHTML = `
      <div class="prev-head">Previous results — ${matches.length} log${matches.length > 1 ? "s" : ""} of this WOD</div>
      <ul class="prev-list">${rows}</ul>
      <p class="muted prev-foot">Matched on exercises &amp; reps. Weights shown for orientation only.</p>`;
  }

  // ---------- exercise rows ----------
  function addExerciseRow(name = "", reps = "", weight = "") {
    const li = document.createElement("li");
    li.className = "ex-row";
    li.innerHTML = `
      <input type="text" class="ex-name" placeholder="Exercise" list="exNames" value="${escape(name)}">
      <input type="text" class="ex-reps" placeholder="reps" value="${escape(reps)}" inputmode="numeric">
      <input type="text" class="ex-weight" placeholder="weight" value="${escape(weight)}">
      <button type="button" class="ex-del" title="Remove" aria-label="Remove">✕</button>`;
    li.querySelector(".ex-del").addEventListener("click", () => {
      li.remove();
      hidePrev();
    });
    // editing the WOD invalidates a shown previous-results panel
    li.querySelectorAll(".ex-name, .ex-reps").forEach((i) => i.addEventListener("input", hidePrev));
    el.exList.appendChild(li);
  }

  function hidePrev() {
    el.prevPanel.className = "prev-panel hidden";
    el.prevPanel.innerHTML = "";
  }

  function resetExercises() {
    el.exList.innerHTML = "";
    addExerciseRow();
    addExerciseRow();
  }

  // datalist of exercise names seen before, for quick re-entry
  function refreshExerciseNames() {
    const names = new Set();
    Store.all().forEach((e) => (e.exercises || []).forEach((x) => x.name && names.add(x.name)));
    el.exNames.innerHTML = [...names].sort().map((n) => `<option value="${escape(n)}">`).join("");
  }

  // ---------- visibility helpers ----------
  function showStruct(type) {
    document.querySelectorAll(".struct").forEach((s) =>
      s.classList.toggle("hidden", s.dataset.for !== type));
  }
  function showResultFields(type) {
    document.querySelectorAll(".result-fields").forEach((f) =>
      f.classList.toggle("hidden", f.dataset.for !== type));
  }

  // ---------- history ----------
  function render() {
    refreshExerciseNames();
    const list = Store.all();
    el.histCount.textContent = list.length ? `${list.length} logged` : "";
    el.emptyHistory.style.display = list.length ? "none" : "block";
    el.wodList.innerHTML = list.map((e) => `
      <li class="wod-item">
        <div class="wod-main">
          <div class="wod-top">
            <span class="badge ${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
            <span class="wod-name">${escape(fmtStruct(e))}</span>
          </div>
          <div class="wod-ex">${fmtExercises(e.exercises) || "<span class='muted'>—</span>"}</div>
          <div class="wod-result">${escape(e.result)}</div>
          <div class="wod-meta">${fmtDate(e.date)}</div>
          ${e.notes ? `<div class="wod-notes">${escape(e.notes)}</div>` : ""}
        </div>
        <button class="del-btn" data-id="${e.id}" title="Delete" aria-label="Delete">✕</button>
      </li>`).join("");

    el.wodList.querySelectorAll(".del-btn").forEach((b) =>
      b.addEventListener("click", () => {
        if (confirm("Delete this WOD?")) { Store.remove(b.dataset.id); render(); }
      }));
  }

  // ---------- prefill from a finished timer ----------
  function prefillFromTimer(summary) {
    if (!summary) return;
    el.fType.value = summary.type;
    showStruct(summary.type);
    showResultFields(summary.type);
    if (summary.type === "fortime") {
      if (summary.timeStr) el.rFortime.value = summary.timeStr;
    } else if (summary.type === "amrap" && summary.durationSec != null) {
      el.sAmrapMin.value = Math.floor(summary.durationSec / 60);
      el.sAmrapSec.value = summary.durationSec % 60;
    } else if (summary.type === "tabata") {
      if (summary.rounds != null) el.sTabRounds.value = summary.rounds;
      if (summary.workSec != null) el.sTabWork.value = summary.workSec;
      if (summary.restSec != null) el.sTabRest.value = summary.restSec;
    }
    hidePrev();
  }

  function init() {
    el = {
      form: document.getElementById("logForm"),
      fDate: document.getElementById("fDate"),
      fType: document.getElementById("fType"),
      fNotes: document.getElementById("fNotes"),
      sRounds: document.getElementById("sRounds"),
      sAmrapMin: document.getElementById("sAmrapMin"),
      sAmrapSec: document.getElementById("sAmrapSec"),
      sTabRounds: document.getElementById("sTabRounds"),
      sTabWork: document.getElementById("sTabWork"),
      sTabRest: document.getElementById("sTabRest"),
      exList: document.getElementById("exList"),
      exNames: document.getElementById("exNames"),
      addExercise: document.getElementById("addExercise"),
      checkPrev: document.getElementById("checkPrev"),
      prevPanel: document.getElementById("prevPanel"),
      rFortime: document.getElementById("rFortime"),
      rRounds: document.getElementById("rRounds"),
      rReps: document.getElementById("rReps"),
      rTabata: document.getElementById("rTabata"),
      wodList: document.getElementById("wodList"),
      histCount: document.getElementById("histCount"),
      emptyHistory: document.getElementById("emptyHistory"),
    };

    el.fDate.value = new Date().toISOString().slice(0, 10);

    el.fType.addEventListener("change", () => {
      showStruct(el.fType.value);
      showResultFields(el.fType.value);
      hidePrev();
    });
    [el.sRounds, el.sAmrapMin, el.sAmrapSec, el.sTabRounds, el.sTabWork, el.sTabRest]
      .forEach((i) => i.addEventListener("input", hidePrev));

    el.addExercise.addEventListener("click", () => addExerciseRow());
    el.checkPrev.addEventListener("click", checkPrevious);

    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const type = el.fType.value;
      const exercises = readExercises();
      if (!exercises.length) {
        alert("Add at least one exercise before saving.");
        return;
      }
      Store.add({
        date: el.fDate.value,
        type,
        struct: readStruct(type),
        exercises,
        result: readResult(type),
        notes: el.fNotes.value.trim(),
      });
      el.form.reset();
      el.fDate.value = new Date().toISOString().slice(0, 10);
      showStruct("fortime");
      showResultFields("fortime");
      resetExercises();
      hidePrev();
      render();
      App.go("history");
    });

    resetExercises();
    render();
  }

  return { init, render, prefillFromTimer };
})();
