/* WOD logging form + history rendering. */
const Log = (() => {
  let el = {};

  const TYPE_LABEL = { fortime: "For Time", amrap: "AMRAP", tabata: "Tabata" };

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function readResult(type) {
    if (type === "fortime") {
      return el.rFortime.value.trim() || "—";
    }
    if (type === "amrap") {
      const r = parseInt(el.rRounds.value, 10) || 0;
      const reps = parseInt(el.rReps.value, 10) || 0;
      return reps ? `${r} rounds + ${reps} reps` : `${r} rounds`;
    }
    return el.rTabata.value.trim() || "—";
  }

  function showResultFields(type) {
    document.querySelectorAll(".result-fields").forEach((f) =>
      f.classList.toggle("hidden", f.dataset.for !== type));
  }

  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function render() {
    const list = Store.all();
    el.histCount.textContent = list.length ? `${list.length} logged` : "";
    el.emptyHistory.style.display = list.length ? "none" : "block";
    el.wodList.innerHTML = list.map((e) => `
      <li class="wod-item">
        <div class="wod-main">
          <div class="wod-top">
            <span class="wod-name">${escape(e.name)}</span>
            <span class="badge ${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
          </div>
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

  // Pre-fill the form from a finished timer result, then switch to the Log tab.
  function prefillFromTimer(summary) {
    if (!summary) return;
    el.fType.value = summary.type;
    showResultFields(summary.type);
    if (summary.type === "fortime" && summary.time) el.rFortime.value = summary.time;
    el.fName.focus();
  }

  function init() {
    el = {
      form: document.getElementById("logForm"),
      fDate: document.getElementById("fDate"),
      fName: document.getElementById("fName"),
      fType: document.getElementById("fType"),
      fNotes: document.getElementById("fNotes"),
      rFortime: document.getElementById("rFortime"),
      rRounds: document.getElementById("rRounds"),
      rReps: document.getElementById("rReps"),
      rTabata: document.getElementById("rTabata"),
      wodList: document.getElementById("wodList"),
      histCount: document.getElementById("histCount"),
      emptyHistory: document.getElementById("emptyHistory"),
    };

    // default date = today
    el.fDate.value = new Date().toISOString().slice(0, 10);

    el.fType.addEventListener("change", () => showResultFields(el.fType.value));

    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const type = el.fType.value;
      Store.add({
        date: el.fDate.value,
        name: el.fName.value.trim(),
        type,
        result: readResult(type),
        notes: el.fNotes.value.trim(),
      });
      el.form.reset();
      el.fDate.value = new Date().toISOString().slice(0, 10);
      showResultFields("fortime");
      render();
      App.go("history");
    });

    render();
  }

  return { init, render, prefillFromTimer };
})();
