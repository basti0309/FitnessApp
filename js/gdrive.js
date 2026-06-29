/* Google Drive sync.

   Stores all WOD + run data as a single JSON file (CONFIG.driveFileName) in the
   user's own Drive, using Google Identity Services for auth and the Drive REST
   API. Scope is drive.file — the app can only see the file it creates. The
   OAuth Client ID is public by design, so this works from a static site.

   Conflict policy: last-write-wins by document timestamp (single-user app). */
const Drive = (() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const FLAG = "wodbox.driveConnected";
  const TS = "wodbox.updatedAt";

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
  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      if (!gisReady()) return reject(new Error("Google sign-in not loaded yet — try again in a moment."));
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.googleClientId, scope: SCOPE, callback: () => {},
        });
      }
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
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

  return { init };
})();
