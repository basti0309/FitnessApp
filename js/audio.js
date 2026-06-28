/* Synthesized sound engine using the Web Audio API.
   No audio files required — all tones are generated on the fly. */
const Sound = (() => {
  let ctx = null;
  let muted = false;

  // Lazily create / resume the AudioContext. Must be triggered by a user
  // gesture (e.g. pressing Start) or browsers will keep it suspended.
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Play a single tone. t = offset in seconds from "now".
  function tone(freq, start, dur, { type = "sine", gain = 0.25 } = {}) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // quick attack + smooth release so beeps don't click
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },

    // Short tick for the 3-2-1 countdown before a phase change.
    countdownTick() { ensure(); tone(660, 0, 0.12, { type: "square", gain: 0.2 }); },

    // High double-beep when WORK begins.
    workStart() {
      ensure();
      tone(880, 0, 0.18, { type: "square", gain: 0.3 });
      tone(1175, 0.18, 0.22, { type: "square", gain: 0.3 });
    },

    // Low single beep when REST begins.
    restStart() { ensure(); tone(392, 0, 0.3, { type: "sine", gain: 0.3 }); },

    // Rising 3-note tune when a workout/timer starts.
    startTune() {
      ensure();
      tone(523, 0.0, 0.14, { type: "triangle" });
      tone(659, 0.14, 0.14, { type: "triangle" });
      tone(880, 0.28, 0.28, { type: "triangle", gain: 0.3 });
    },

    // Falling 2-note tune when paused.
    pauseTune() {
      ensure();
      tone(587, 0.0, 0.16, { type: "triangle" });
      tone(392, 0.16, 0.26, { type: "triangle" });
    },

    // Triumphant flourish when the whole workout is finished.
    finishTune() {
      ensure();
      tone(523, 0.0, 0.14, { type: "square" });
      tone(659, 0.14, 0.14, { type: "square" });
      tone(784, 0.28, 0.14, { type: "square" });
      tone(1047, 0.42, 0.4, { type: "square", gain: 0.32 });
    },
  };
})();
