/* Per-device settings: Anthropic API key + optional physiology overrides.
   Kept in localStorage only — never synced to the cloud document. */
const Settings = (() => {
  const KEY = "wodbox.settings.v1";
  let data = read();

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(data)); }

  function get(k) { return data[k]; }
  function apiKey() { return (data.apiKey || "").trim(); }

  // profile overrides (numbers or null)
  function hrMaxOverride() { return num(data.hrMax); }
  function lthrOverride() { return num(data.lthr); }
  function thrPaceOverride() { return data.thrPace ? Zones.parseTime(data.thrPace) : null; }
  function num(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }

  function init() {
    const el = {
      form: document.getElementById("settingsForm"),
      key: document.getElementById("setKey"),
      hrMax: document.getElementById("setHrMax"),
      lthr: document.getElementById("setLthr"),
      thrPace: document.getElementById("setThrPace"),
      gpxFolder: document.getElementById("setGpxFolder"),
      gpxAuto: document.getElementById("setGpxAuto"),
      saved: document.getElementById("setSaved"),
      driveStatus: document.getElementById("driveStatus"),
    };
    el.key.value = data.apiKey || "";
    el.hrMax.value = data.hrMax || "";
    el.lthr.value = data.lthr || "";
    el.thrPace.value = data.thrPace || "";
    el.gpxFolder.value = data.gpxFolder || "";
    el.gpxAuto.checked = data.gpxAuto !== false;

    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      data.apiKey = el.key.value.trim();
      data.hrMax = el.hrMax.value.trim();
      data.lthr = el.lthr.value.trim();
      data.thrPace = el.thrPace.value.trim();
      data.gpxFolder = el.gpxFolder.value.trim();
      data.gpxAuto = el.gpxAuto.checked;
      save();
      el.saved.textContent = "Saved ✓";
      setTimeout(() => (el.saved.textContent = ""), 2000);
      document.dispatchEvent(new Event("settings-changed"));
    });

    if (CONFIG.googleClientId) {
      el.driveStatus.textContent = "Sign in with Google to sync your WODs and runs across devices via your Drive.";
    }
  }

  return { init, get, apiKey, hrMaxOverride, lthrOverride, thrPaceOverride };
})();
