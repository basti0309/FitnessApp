/* Workout timer supporting three modes:
   - tabata  : repeating WORK / REST intervals for N rounds
   - amrap   : single countdown
   - fortime : count-up stopwatch with optional time cap
   Time is tracked against performance.now() so it never drifts. */
const Timer = (() => {
  // ---- DOM ----
  let el = {};

  // ---- state ----
  let mode = "tabata";
  let segments = [];      // [{ type, dur }] in seconds (countdown modes)
  let segIndex = 0;
  let running = false;
  let finished = false;
  let countUp = false;    // fortime
  let capSec = 0;         // fortime cap (0 = none)

  let phaseStart = 0;         // performance.now() at last resume
  let elapsedBeforePause = 0; // ms accumulated in current phase before pause
  let lastShownSec = null;    // for detecting whole-second transitions
  let raf = null;

  const LEAD_IN = 10;         // seconds of pre-start countdown (all modes)
  let leadIn = false;         // currently in the GET READY countdown
  let begun = false;          // the actual workout has started (past lead-in)
  let totalRounds = 0;        // tabata rounds, for the lead-in label

  let summary = null;     // result handed to the Log tab

  // ---------- helpers ----------
  const now = () => performance.now();

  function fmt(totalSec) {
    totalSec = Math.max(0, Math.ceil(totalSec));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function currentElapsedMs() {
    return elapsedBeforePause + (running ? now() - phaseStart : 0);
  }

  // ---------- build the plan for the chosen mode ----------
  function buildPlan() {
    countUp = false;
    capSec = 0;
    segments = [];
    segIndex = 0;

    if (mode === "tabata") {
      const rounds = clampInt(el.tabRounds.value, 1, 99, 8);
      const work = clampInt(el.tabWork.value, 1, 600, 20);
      const rest = clampInt(el.tabRest.value, 0, 600, 10);
      totalRounds = rounds;
      for (let r = 1; r <= rounds; r++) {
        segments.push({ type: "work", dur: work, round: r, total: rounds });
        if (rest > 0 && r < rounds) {
          segments.push({ type: "rest", dur: rest, round: r, total: rounds });
        }
      }
    } else if (mode === "amrap") {
      const total = clampInt(el.amrapMin.value, 0, 180, 12) * 60 + clampInt(el.amrapSec.value, 0, 59, 0);
      segments.push({ type: "amrap", dur: Math.max(1, total) });
    } else {
      countUp = true;
      capSec = clampInt(el.capMin.value, 0, 180, 0) * 60;
    }
  }

  function clampInt(v, min, max, fallback) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = fallback;
    return Math.min(max, Math.max(min, n));
  }

  // ---------- control ----------
  function start() {
    Sound.unlock();
    if (finished) reset();
    // first press → build the plan and enter the 10s GET READY lead-in
    if (!begun && !leadIn) {
      buildPlan();
      leadIn = true;
      elapsedBeforePause = 0;
      segIndex = 0;
      lastShownSec = null;
      applyPhaseClass(null);
    }
    running = true;
    finished = false;
    phaseStart = now();
    el.startPauseBtn.textContent = "Pause";
    el.logResultBtn.hidden = true;
    loop();
  }

  // lead-in finished → kick off the actual workout with a clear "go" cue
  function beginWorkout() {
    leadIn = false;
    begun = true;
    elapsedBeforePause = 0;
    phaseStart = now();
    lastShownSec = null;
    if (countUp) {
      Sound.goStart();
    } else {
      const seg = segments[0];
      if (seg.type === "work") { applyPhaseClass("work"); Sound.goWork(); }
      else { applyPhaseClass(seg.type === "rest" ? "rest" : null); Sound.goStart(); }
    }
    tick();
  }

  function pause() {
    if (!running) return;
    elapsedBeforePause = currentElapsedMs();
    running = false;
    cancelAnimationFrame(raf);
    Sound.pause();
    el.startPauseBtn.textContent = "Resume";
  }

  function toggle() { running ? pause() : start(); }

  function reset() {
    running = false;
    finished = false;
    leadIn = false;
    begun = false;
    cancelAnimationFrame(raf);
    segIndex = 0;
    elapsedBeforePause = 0;
    lastShownSec = null;
    summary = null;
    applyPhaseClass(null);
    el.phaseLabel.textContent = "READY";
    el.clockDisplay.textContent = "00:00";
    el.roundLabel.textContent = "";
    el.startPauseBtn.textContent = "Start";
    el.logResultBtn.hidden = true;
  }

  function setMode(m) {
    mode = m;
    reset();
  }

  // ---------- the loop ----------
  function loop() {
    if (!running) return;
    tick();
    raf = requestAnimationFrame(loop);
  }

  function tick() {
    const elapsed = currentElapsedMs() / 1000;

    if (leadIn) {
      const remaining = LEAD_IN - elapsed;
      const remSec = Math.ceil(remaining);
      if (remSec !== lastShownSec) {
        if (remSec <= 3 && remSec >= 1) Sound.countdown();
        lastShownSec = remSec;
      }
      if (remaining <= 0) { beginWorkout(); return; }
      el.phaseLabel.textContent = "GET READY";
      el.clockDisplay.textContent = String(Math.max(0, remSec));
      el.roundLabel.textContent =
        mode === "tabata" ? `${totalRounds} rounds` : mode === "amrap" ? "AMRAP" : "For Time";
      return;
    }

    if (countUp) {
      // For Time stopwatch
      el.phaseLabel.textContent = "ELAPSED";
      el.clockDisplay.textContent = fmt(elapsed);
      el.roundLabel.textContent = capSec ? `Cap ${fmt(capSec)}` : "";
      if (capSec && elapsed >= capSec) finishAll(capSec, true);
      return;
    }

    const seg = segments[segIndex];
    const remaining = seg.dur - elapsed;

    // 3-2-1 countdown ticks before a phase ends
    const remSec = Math.ceil(remaining);
    if (remSec !== lastShownSec) {
      if (remSec <= 3 && remSec >= 1) Sound.countdown();
      lastShownSec = remSec;
    }

    if (remaining <= 0) {
      advance();
      return;
    }

    el.clockDisplay.textContent = fmt(remaining);
    if (seg.type === "amrap") {
      el.phaseLabel.textContent = "AMRAP";
      el.roundLabel.textContent = "As many rounds as possible";
    } else {
      el.phaseLabel.textContent = seg.type === "work" ? "WORK" : "REST";
      el.roundLabel.textContent = `Round ${seg.round} / ${seg.total}`;
    }
  }

  function advance() {
    segIndex++;
    elapsedBeforePause = 0;
    phaseStart = now();
    lastShownSec = null;

    if (segIndex >= segments.length) {
      finishAll();
      return;
    }
    const seg = segments[segIndex];
    if (seg.type === "work") { applyPhaseClass("work"); Sound.goWork(); }
    else if (seg.type === "rest") { applyPhaseClass("rest"); Sound.goRest(); }
    tick();
  }

  function finishAll(finalElapsed, capped) {
    running = false;
    finished = true;
    cancelAnimationFrame(raf);
    applyPhaseClass("done");
    Sound.finish();
    el.phaseLabel.textContent = capped ? "TIME CAPPED" : "DONE";
    el.startPauseBtn.textContent = "Start";
    el.roundLabel.textContent = "Nice work! 🔥";

    // Build a summary the Log tab can pre-fill from (structure carries over).
    if (mode === "tabata") {
      summary = {
        type: "tabata",
        rounds: clampInt(el.tabRounds.value, 1, 99, 8),
        workSec: clampInt(el.tabWork.value, 1, 600, 20),
        restSec: clampInt(el.tabRest.value, 0, 600, 10),
      };
      el.clockDisplay.textContent = "DONE";
    } else if (mode === "amrap") {
      summary = { type: "amrap", durationSec: segments[0].dur };
      el.clockDisplay.textContent = fmt(segments[0].dur);
    } else {
      const t = finalElapsed != null ? finalElapsed : currentElapsedMs() / 1000;
      summary = { type: "fortime", timeStr: fmt(t) };
      el.clockDisplay.textContent = fmt(t);
    }
    el.logResultBtn.hidden = false;
  }

  function applyPhaseClass(state) {
    el.clockCard.classList.remove("is-work", "is-rest", "is-done");
    if (state) el.clockCard.classList.add("is-" + state);
  }

  // ---------- init ----------
  function init() {
    el = {
      tabRounds: document.getElementById("tabRounds"),
      tabWork: document.getElementById("tabWork"),
      tabRest: document.getElementById("tabRest"),
      amrapMin: document.getElementById("amrapMin"),
      amrapSec: document.getElementById("amrapSec"),
      capMin: document.getElementById("capMin"),
      clockCard: document.getElementById("clockCard"),
      phaseLabel: document.getElementById("phaseLabel"),
      clockDisplay: document.getElementById("clockDisplay"),
      roundLabel: document.getElementById("roundLabel"),
      startPauseBtn: document.getElementById("startPauseBtn"),
      resetBtn: document.getElementById("resetBtn"),
      muteBtn: document.getElementById("muteBtn"),
      logResultBtn: document.getElementById("logResultBtn"),
    };

    el.startPauseBtn.addEventListener("click", toggle);
    el.resetBtn.addEventListener("click", reset);
    el.muteBtn.addEventListener("click", () => {
      const m = Sound.toggleMute();
      el.muteBtn.textContent = m ? "🔇" : "🔊";
    });

    // mode segmented control
    document.querySelectorAll("#timerModes .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#timerModes .seg-btn").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        document.getElementById("setTabata").classList.toggle("hidden", b.dataset.mode !== "tabata");
        document.getElementById("setAmrap").classList.toggle("hidden", b.dataset.mode !== "amrap");
        document.getElementById("setFortime").classList.toggle("hidden", b.dataset.mode !== "fortime");
        setMode(b.dataset.mode);
      });
    });

    // keyboard: space toggles start/pause when on the timer tab
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && document.getElementById("tab-timer").classList.contains("is-active")
          && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        toggle();
      }
    });
  }

  return { init, getSummary: () => summary };
})();
