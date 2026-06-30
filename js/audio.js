/* Synthesized signal tones (Web Audio) + spoken cues (Web Speech).
   Loud, square-wave signal beeps designed to be heard mid-workout. */
const Sound = (() => {
  let ctx = null;
  let muted = false;
  let primed = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One strong tone. t = offset (s) from now.
  function tone(freq, start, dur, { type = "square", gain = 0.8 } = {}) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start + 0.005;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);   // fast, punchy attack
    g.gain.setValueAtTime(gain, t0 + dur * 0.75);            // hold full volume
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // Spoken cue. Falls back silently if speech synthesis is unavailable.
  function say(text) {
    if (muted || typeof speechSynthesis === "undefined") return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1; u.pitch = 1; u.volume = 1; u.lang = "en-US";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  return {
    // Call on a user gesture (Start press): resume + prime audio and speech.
    unlock() {
      const c = ensure();
      if (c && !primed) {
        primed = true;
        try {
          const buf = c.createBuffer(1, 1, 22050);
          const src = c.createBufferSource();
          src.buffer = buf; src.connect(c.destination); src.start(0);
        } catch (e) { /* ignore */ }
        try {
          if (typeof speechSynthesis !== "undefined") {
            const u = new SpeechSynthesisUtterance(" ");
            u.volume = 0; speechSynthesis.speak(u); // unlock speech on iOS/Safari
          }
        } catch (e) { /* ignore */ }
      }
    },
    toggleMute() {
      muted = !muted;
      if (muted && typeof speechSynthesis !== "undefined") { try { speechSynthesis.cancel(); } catch (e) {} }
      return muted;
    },
    isMuted() { return muted; },

    // Identical strong beep for each of 3-2-1.
    countdown() { ensure(); tone(880, 0, 0.2, { gain: 0.85 }); },

    // WORK begins: high, strong, rising + voice.
    goWork() { ensure(); tone(1047, 0, 0.16, { gain: 0.9 }); tone(1568, 0.17, 0.55, { gain: 0.95 }); say("Work"); },

    // REST begins: low, strong, sustained + voice.
    goRest() { ensure(); tone(523, 0, 0.6, { gain: 0.9 }); say("Rest"); },

    // AMRAP / For Time start.
    goStart() { ensure(); tone(784, 0, 0.16, { gain: 0.9 }); tone(1175, 0.17, 0.5, { gain: 0.95 }); say("Go"); },

    // Pause / resume blip.
    pause() { ensure(); tone(440, 0, 0.12, { type: "sine", gain: 0.5 }); tone(330, 0.13, 0.22, { type: "sine", gain: 0.5 }); },

    // Finished.
    finish() {
      ensure();
      tone(1047, 0.0, 0.16, { gain: 0.9 });
      tone(880, 0.16, 0.16, { gain: 0.9 });
      tone(659, 0.32, 0.6, { gain: 0.95 });
      say("Done");
    },
  };
})();
