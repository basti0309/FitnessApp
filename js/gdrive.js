/* Google Drive sync.

   Stores all WOD + run data as a single JSON file (CONFIG.driveFileName) in the
   user's own Drive, using Google Identity Services for auth and the Drive REST
   API. Scope is drive.file — the app can only see the file it creates. The
   OAuth Client ID is public by design, so this works from a static site.

   Conflict policy: last-write-wins by document timestamp (single-user app). */
const Drive = (() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  // reading GPX exports the user drops into a Drive folder needs read access
  // beyond app-created files; requested only when the GPX import is used
  const GPX_SCOPE = SCOPE + " https://www.googleapis.com/auth/drive.readonly";
  const FLAG = "wodbox.driveConnected";
  const TS = "wodbox.updatedAt";
  const GPX_SEEN = "wodbox.gpxFiles.v1";      // Drive file ids already fetched (per device)
  const GPX_LAST = "wodbox.gpxLastCheck";     // last automatic folder check

  let tokenClient = null;
  let accessToken = null;
  let fileId = null;
  let connected = false;
  let syncTimer = null;
  let el = {};

  // ---------- local data document ----------
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
  function snapshot() {
    return {
      version: 1,
      updatedAt: parseInt(localStorage.getItem(TS), 10) || 0,
      wods: lsGet("wodbox.entries.v2"),
      runs: lsGet("wodbox.runs.v1"),
    };
  }
  function applySnapshot(doc) {
    localStorage.setItem("wodbox.entries.v2", JSON.stringify(doc.wods || []));
    localStorage.setItem("wodbox.runs.v1", JSON.stringify(doc.runs || []));
    localStorage.setItem(TS, String(doc.updatedAt || Date.now()));
    document.dispatchEvent(new Event("data-applied"));
  }

  // ---------- auth ----------
  function gisReady() {
    return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
  }
  let pending = null;
  function ensureClient() {
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPE,
      callback: (resp) => {
        const p = pending; pending = null;
        if (!p) return;
        if (resp.error) return p.reject(new Error(resp.error));
        accessToken = resp.access_token;
        p.resolve(accessToken);
      },
      // fires for non-OAuth failures: popup blocked/closed, etc.
      error_callback: (err) => {
        const p = pending; pending = null;
        if (p) p.reject(new Error(err.type || "popup_failed"));
      },
    });
  }
  function getToken(interactive, scope) {
    return new Promise((resolve, reject) => {
      if (!gisReady()) return reject(new Error("Google sign-in didn't load (check network / blockers)."));
      ensureClient();
      pending = { resolve, reject };
      try { tokenClient.requestAccessToken({ prompt: interactive ? "" : "none", scope: scope || SCOPE }); }
      catch (e) { pending = null; reject(e); }
    });
  }

  // ---------- Drive REST ----------
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: "Bearer " + accessToken, ...(opts.headers || {}) },
    });
    if (res.status === 401) { accessToken = null; throw new Error("auth-expired"); }
    if (!res.ok) throw new Error(`Drive error ${res.status}`);
    return res;
  }
  async function findFile() {
    const q = encodeURIComponent(`name='${CONFIG.driveFileName}' and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
    const json = await res.json();
    return json.files && json.files[0] ? json.files[0].id : null;
  }
  async function readFile(id) {
    const res = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return res.json();
  }
  async function writeFile(content) {
    const body = JSON.stringify(content);
    if (fileId) {
      await api(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body,
      });
    } else {
      const boundary = "wodbox" + Math.floor(performance.now());
      const meta = { name: CONFIG.driveFileName, mimeType: "application/json" };
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(meta) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        body + `\r\n--${boundary}--`;
      const res = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      fileId = (await res.json()).id;
    }
  }

  // ---------- GPX folder import ----------
  function seenIds() { try { return JSON.parse(localStorage.getItem(GPX_SEEN)) || []; } catch { return []; } }

  async function importGpx(interactive = true, onStatus = () => {}) {
    const folder = (Settings.get("gpxFolder") || "").trim() || "Zepp";
    try {
      onStatus("Checking Google Drive…");
      await getToken(interactive, GPX_SCOPE);

      const fq = encodeURIComponent(
        `name='${folder.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const fRes = await (await api(`https://www.googleapis.com/drive/v3/files?q=${fq}&fields=files(id,name)`)).json();
      const dir = fRes.files && fRes.files[0];
      if (!dir) { onStatus(`⚠ No folder named “${folder}” in your Drive. Create it (or change the name in ⚙ Settings) and drop your GPX exports there.`); return null; }

      const lq = encodeURIComponent(`'${dir.id}' in parents and trashed=false and name contains '.gpx'`);
      const lRes = await (await api(`https://www.googleapis.com/drive/v3/files?q=${lq}&pageSize=200&fields=files(id,name)`)).json();
      const all = lRes.files || [];
      const seen = seenIds();
      const fresh = all.filter((f) => !seen.includes(f.id));
      if (!fresh.length) {
        onStatus(`Up to date — no new GPX files in “${folder}” (${all.length} known).`);
        localStorage.setItem(GPX_LAST, String(Date.now()));
        return { added: 0, skipped: 0, failed: [] };
      }

      onStatus(`Downloading ${fresh.length} GPX file${fresh.length === 1 ? "" : "s"}…`);
      const items = [];
      for (const f of fresh) {
        const txt = await (await api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).text();
        items.push({ name: f.name, text: txt, id: f.id });
      }
      const out = Running.importGpxRuns(items);
      // remember every fetched id (also dupes/failures — no point re-downloading)
      localStorage.setItem(GPX_SEEN, JSON.stringify([...seen, ...fresh.map((f) => f.id)]));
      localStorage.setItem(GPX_LAST, String(Date.now()));
      onStatus((out.added ? "✓ " : "") + Running.gpxSummary(out));
      return out;
    } catch (err) {
      if (!interactive) return null; // silent daily check — stay quiet
      onStatus("⚠ " + (err.message === "auth-expired" ? "Google session expired — try again." : err.message));
      return null;
    }
  }

  // once per day, on app open: pull new GPX files automatically
  function maybeAutoImport() {
    if (Settings.get("gpxAuto") === false) return;
    const last = parseInt(localStorage.getItem(GPX_LAST), 10) || 0;
    if (Date.now() - last < 20 * 3600 * 1000) return;
    importGpx(false, (t) => {
      const s = document.getElementById("gpxStatus");
      if (s) s.textContent = t;
    });
  }

  // ---------- orchestration ----------
  async function connect(interactive = true) {
    setStatus("Connecting…");
    try {
      await getToken(interactive);
      fileId = await findFile();
      const remote = fileId ? await readFile(fileId) : null;
      const local = snapshot();
      if (remote && (remote.updatedAt || 0) > local.updatedAt) {
        applySnapshot(remote);                 // remote is newer — pull
      } else {
        await writeFile(local);                // local is newer/only — push
      }
      connected = true;
      localStorage.setItem(FLAG, "1");
      setConnectedUI();
      setStatus("Synced with Google Drive ✓");
      maybeAutoImport();
    } catch (err) {
      if (err.message === "auth-expired" && !interactive) return; // silent attempt failed; stay local
      connected = false;
      setStatus("⚠ " + err.message);
    }
  }

  function scheduleSync() {
    if (!connected) return;
    clearTimeout(syncTimer);
    setStatus("Syncing…");
    syncTimer = setTimeout(async () => {
      try {
        if (!accessToken) await getToken(false);
        await writeFile(snapshot());
        setStatus("Synced ✓");
      } catch (err) {
        if (err.message === "auth-expired") { setStatus("Session expired — reconnect to sync."); connected = false; setDisconnectedUI(); }
        else setStatus("⚠ " + err.message);
      }
    }, 1200);
  }

  // ---------- UI ----------
  function setStatus(t) { if (el.status) el.status.textContent = t; }
  function setConnectedUI() { if (el.connect) { el.connect.textContent = "Reconnect"; el.sync.hidden = false; } }
  function setDisconnectedUI() { if (el.connect) { el.connect.textContent = "Connect Google Drive"; el.sync.hidden = true; } }

  function init() {
    el = {
      connect: document.getElementById("driveConnect"),
      sync: document.getElementById("driveSync"),
      status: document.getElementById("driveStatus"),
    };
    if (!CONFIG.googleClientId) { setStatus("Cloud sync not configured."); el.connect.disabled = true; return; }

    el.connect.addEventListener("click", () => connect(true));
    el.sync.addEventListener("click", () => connect(true));

    // any local change bumps the timestamp and (if connected) pushes to Drive
    document.addEventListener("data-changed", () => {
      localStorage.setItem(TS, String(Date.now()));
      scheduleSync();
    });

    // auto-reconnect if previously signed in (silent token, no prompt)
    if (localStorage.getItem(FLAG)) {
      const tryAuto = () => gisReady() ? connect(false) : setTimeout(tryAuto, 400);
      tryAuto();
    }
  }

  return { init, importGpx };
})();
