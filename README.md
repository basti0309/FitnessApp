# WOD Box — CrossFit Logger, Timer & Running Analytics

A lightweight, mobile-friendly web app for CrossFit and running. No build step,
no backend — a static site (hosted on GitHub Pages at
<https://basti0309.github.io/FitnessApp/>) with all data in your browser,
optionally synced across devices via your own Google Drive.

## Features

### Timer
- **Four modes:** Tabata, EMOM, AMRAP, For Time (count-up with optional cap).
- **Sets** for Tabata and EMOM (e.g. 3×8 rounds with a set-rest between sets).
- **10-second GET READY countdown** before every start.
- **Loud signal tones + voice cues** (Web Audio + speech synthesis): 3-2-1
  beeps at the end of every interval and of the countdown, then a strong tone
  and a spoken "Work" / "Rest" / "Set rest" / round number / "Go" / "Done".
  Mute with 🔊. Space starts/pauses. First tap unlocks audio (browser policy).
- One-tap **"Log this result →"** pre-fills the log form from a finished timer.

### WOD log
- WODs are logged **by their exercises** (name · reps · optional weight), plus
  the structure (rounds / duration / tabata scheme) — not by a workout name.
- **🔍 Check previous results** finds earlier attempts of the *same* WOD
  (same structure + exercises + reps; **weight is ignored** for matching and
  shown only as orientation).
- History with type badges, structure labels, results, and notes.

### Running
- **GPX import (Zepp & co.):** pick exported `.gpx` files — on iPhone straight
  from Files / iCloud Drive — **paste GPX from the clipboard** (button or
  simply ⌘V on the Run tab), or drop them into a Google Drive folder and let
  the app pull them: on tap ("Import new GPX from Google Drive") and
  automatically once a day when the app opens. Pasting works with GPX *text*
  and with copied GPX *files*. The parser computes distance, moving time,
  avg/max heart rate, elevation gain/loss, and clean **1-km splits with
  per-split HR** from the track points.
- **Grade-adjusted pace (GAP):** every GPX run gets a flat-equivalent pace
  from the **Minetti et al. (2002)** energy-cost-of-running model (the
  science standard behind Strava's GAP): each leg's time is scaled by
  C(0)/C(grade). Elevation is smoothed and hysteresis-filtered (≥3 m) with
  the grade taken over a ~50 m window, so barometer jitter can't fake
  slopes — a flat run gets GAP ≈ pace, real hills the full correction.
  **Best efforts and race predictions use the grade-adjusted times**, so
  hilly runs don't hide fitness. Duplicates are detected via the GPX start time (which
  syncs with your data), so re-selecting or re-syncing everything is always
  safe. iCloud Drive has no web API, so the folder automation is
  Google-Drive-only; the Files picker covers the iCloud path.
- **HR artifact correction:** wrist optical-HR sensors often misread at the
  start (a false spike, then — after a stop — a slow settle) before locking on.
  The importer learns the runner's HR↔effort relationship from the settled part
  of the run, detects the initial decoupled window (both too-high and too-low,
  bridging real pauses), and reconstructs it from the effort model plus a
  physiological onset ramp (τ≈45 s); isolated spikes elsewhere are removed with a
  Hampel filter. The reconstruction uses an HR↔effort model **fit on the
  reliable tail of the run** (with a cardiac-drift term) and extrapolated back,
  so the rebuilt warm-up rises realistically toward the settled HR instead of
  sitting at a flat average. All HR-based figures (avg/max, splits, zones,
  effort labels, predictions, max-HR derivation) use the cleaned signal; raw
  values are kept.
- **Run detail (tap a run in History):** Zepp-style **pace and HR profile**
  charts (filled area, crosshair tooltip), with a **toggle between the corrected
  and the original HR curve** when a correction was applied.
- **HR & pace zones** (Z1–Z5), auto-derived from your runs or profile
  overrides in Settings.
- **Best efforts:** fastest 1 km / 1 mile / 2 km / 5 km / 10 km / 15 km / Half
  segment across all runs, found by a sliding window over your splits, with
  the heart rate of that segment.
- **Race predictions** for 1 km, 1 mile, 5 km, 10 km, Half, Marathon using an
  **HR-adjusted Critical Speed model**: sub-maximal efforts are first scaled
  to estimated max effort from %HRmax (Swain), then a 2-parameter Critical
  Speed fit (with Riegel extrapolation beyond 10 km; Riegel fallback when only
  one distance is available). When the Critical-Speed fit is unreliable (messy
  training data), it anchors on the **most race-like effort** — the one run at
  the highest %HRmax, which best reflects current all-out ability — rather than
  the longest run, so an easy long run can't drag the estimate slow.
- **Recency weighting (current form, not all-time):** best efforts feeding the
  predictions are weighted by how recent they are — a **42-day fitness
  half-life** (~8 weeks; a gentle fade in the spirit of Banister's fitness–fatigue model
  and TrainingPeaks' CTL. Old efforts *fade* (bounded to ≤12%, from detraining
  data) rather than being dropped, so the fit keeps its distance span but
  tracks your current fitness; the prediction can rise again if you detrain.
  Personal records stay all-time (a PR never fades). The current predicted
  time and its trend live on the Progress view (with a 3 mo / 6 mo / 1 yr /
  all display timeframe).

### Progress (analytics)
- **Stat tiles:** 4-week distance (with delta vs the prior 4 weeks), runs and
  time on feet, current predicted race time (with delta vs 4 weeks ago), and
  WODs in the last 4 weeks.
- **Prediction trend** *(chart)*: your predicted race time recomputed after
  every logged run — the model only ever sees runs up to that date — with a
  distance picker (1 km … Marathon) and a timeframe picker (3 mo / 6 mo /
  1 yr / all) for the displayed window. Lower is faster.
- **Weekly distance** *(chart)*: km per week over the last 12 weeks.
- **Time in HR zones** *(chart)*: intensity mix of the last 4 weeks from your
  splits' heart rates (stacked bar + legend).
- **Personal records:** fastest segment *anywhere inside* a run (a fast 5k in
  the middle of a longer run counts) — computed point-exactly from the raw
  GPX track at import, with the date it was set; PRs from the last 4 weeks
  get a **NEW** badge. PRs show real times; the prediction models keep using
  grade-adjusted times. Re-importing an old GPX backfills the exact analysis
  ("re-analyzed") instead of skipping it.
- All charts are hand-rolled SVG (no chart library): hover crosshair/tooltips,
  keyboard navigation on the trend line, and a "View as table" twin under
  every chart so no value is hover- or color-gated.

### Cloud sync
- **Google Drive sync** (free, your own Drive): connect once in ⚙ Settings;
  WODs and runs are stored as a single `wodbox-data.json` in your Drive and
  synced across phone and computer (last write wins, auto-push on changes).
- The Anthropic API key and profile settings stay **device-only** — they are
  never uploaded.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Dark, athletic theme (mobile-first, Safari-safe) |
| `js/config.js` | Public config (Google client ID, Claude model) |
| `js/audio.js` | Web Audio tones + speech cues |
| `js/storage.js` | `localStorage` persistence for WODs |
| `js/zones.js` | Running math: best efforts, zones, Critical Speed model |
| `js/gpx.js` | GPX parser: distance, moving time, HR, auto 1-km splits |
| `js/settings.js` | Device-only settings (API key, HR/pace overrides) |
| `js/charts.js` | Dependency-free SVG charts (line, bars, stacked bar) |
| `js/timer.js` | Timer state machine (Tabata / EMOM / AMRAP / For Time) |
| `js/log.js` | Exercise-based WOD logging + previous-result lookup |
| `js/running.js` | Run tab: GPX import, zones, run history |
| `js/progress.js` | Progress tab: trends, volume, zone mix, PRs |
| `js/gdrive.js` | Google Drive sync |
| `js/app.js` | Tab navigation + wiring |

## Feature log

| Date | Feature |
|------|---------|
| 2026-07-02 | Predictions fixed: anchor the fallback on the most race-like effort (highest %HRmax) instead of the longest run (easy long runs no longer drag the estimate slow); softened recency to an 8-week half-life / 8% cap |
| 2026-07-02 | HR reconstruction improved: reference model fit on the reliable run tail + cardiac-drift term (rebuilds a realistic rising warm-up, not a flat average); fixed the linear solver |
| 2026-07-02 | **HR artifact correction** (Variant B): detect the early optical-sensor warm-up window from HR↔effort decoupling (pause-aware) and reconstruct it (effort model + onset ramp) + Hampel despike; feeds all HR calculations, raw kept. **Run-detail pace/HR profile charts** with corrected↔original HR toggle |
| 2026-07-02 | **Recency-weighted predictions**: best efforts feeding the race predictions fade with a 42-day fitness half-life (Banister / TrainingPeaks CTL), bounded ≤12% (detraining data); PRs stay all-time; no re-import needed |
| 2026-07-02 | **Point-exact personal records**: best efforts computed from raw GPX track points (sliding window, not km-split-aligned), real times for PRs vs GAP for predictions, duplicate imports backfill the new analysis |
| 2026-07-02 | **Run tab restructure**: GPX-only import (manual run form removed), run history moved to its own History sub-tab, Predictions view folded into Progress |
| 2026-07-01 | **Grade-adjusted pace** (Minetti 2002) feeding best efforts & predictions; elevation gain/loss with noise filtering; clipboard paste fixed for copied GPX *files* |
| 2026-07-01 | **Timeframe picker** (3 mo/6 mo/1 yr/all) for the prediction trend and the prediction model; **paste GPX from clipboard** (button + ⌘V); screenshot/AI upload removed (GPX replaced it) |
| 2026-07-01 | **GPX import**: file picker (iPhone Files/iCloud) + Google Drive folder pull with daily auto-check; parser with 1-km splits & HR; duplicate detection via GPX start time |
| 2026-07-01 | **Progress analytics**: prediction-trend chart, weekly distance, time-in-zones, PR table with NEW badges, 4-week stat tiles; SVG chart engine with tooltips + table view; screen-recording import removed |
| 2026-06-30 | EMOM mode, Sets + set-rest for Tabata/EMOM, Safari alignment pass |
| 2026-06-30 | Loud signal tones + voice cues, 10 s pre-start countdown, 3-2-1 beeps |
| 2026-06-29 | HR-adjusted Critical Speed prediction model; best-effort segment analysis from splits |
| 2026-06-29 | Google Drive cloud sync |
| 2026-06-28 | Running log with Claude screenshot extraction, HR/pace zones, race predictions |
| 2026-06-28 | Exercise-based WOD logging with previous-result lookup (weights as orientation) |
| 2026-06-27 | Initial app: WOD logger + Tabata/AMRAP/For Time timer with sounds, GitHub Pages deploy |

## Run it locally

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```
