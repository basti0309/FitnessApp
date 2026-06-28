# WOD Box — CrossFit Logger & Timer

A lightweight, mobile-friendly web app for logging CrossFit WODs and running
your workout clock. No build step, no backend, no dependencies — just open
`index.html` (or host the folder anywhere static, e.g. GitHub Pages).

## Features

- **Log WODs** of three types: **For Time**, **AMRAP**, and **Tabata**, each
  with type-appropriate result fields, notes, and date.
- **Workout timer** with three modes:
  - **Tabata** — repeating WORK / REST intervals for a set number of rounds.
  - **AMRAP** — a single countdown.
  - **For Time** — a count-up stopwatch with an optional time cap.
- **Sound cues** (synthesized with the Web Audio API — no audio files needed):
  - a rising **start** tune and a falling **pause** tune,
  - a **3-2-1 countdown** before each interval ends,
  - distinct **work** / **rest** beeps,
  - a **finish** flourish. Mute with the 🔊 button.
- **History** saved in your browser via `localStorage` (private to your device).
- One-tap **"Log this result →"** after a timer finishes pre-fills the log form.
- Press **Space** to start/pause the timer.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Dark, athletic theme (mobile-first) |
| `js/audio.js` | Web Audio sound engine |
| `js/storage.js` | `localStorage` persistence |
| `js/timer.js` | Timer state machine (Tabata / AMRAP / For Time) |
| `js/log.js` | Logging form + history rendering |
| `js/app.js` | Tab navigation + wiring |

## Run it

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

> Tip: sound needs a user gesture to start (browser policy) — the first press
> of **Start** unlocks audio.
