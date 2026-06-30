/* Extract distinct frames from a screen-recording video, entirely in the
   browser (the browser's own decoder handles the codec — iPhone Safari decodes
   HEVC screen recordings natively). Near-identical consecutive frames are
   deduplicated so we keep ~one image per screen the user paused on, then the
   set is capped to keep token cost low. Returns base64 image blocks ready for
   the Claude vision call. */
const VideoFrames = (() => {
  async function extract(file, { stepSec = 0.4, maxFrames = 10, maxWidth = 820, onProgress } = {}) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.src = url; v.muted = true; v.playsInline = true; v.preload = "auto";
    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error("Your browser can't open this video format (try recording on the device you're uploading from)."));
        setTimeout(() => rej(new Error("Video didn't load (timeout).")), 20000);
      });
      const dur = v.duration, W = v.videoWidth, H = v.videoHeight;
      if (!W || !H || !isFinite(dur) || dur <= 0) throw new Error("Couldn't read the video.");

      const cw = Math.min(maxWidth, W), ch = Math.round((H * cw) / W);
      const canvas = document.createElement("canvas"); canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext("2d");
      const sc = document.createElement("canvas"); sc.width = 16; sc.height = 16;
      const sx = sc.getContext("2d");

      const times = [];
      for (let t = 0; t < dur; t += stepSec) times.push(t);

      const kept = [];
      let lastSig = null, i = 0;
      for (const t of times) {
        await seek(v, t);
        ctx.drawImage(v, 0, 0, cw, ch);
        sx.drawImage(v, 0, 0, 16, 16);
        const sig = sx.getImageData(0, 0, 16, 16).data;
        if (lastSig == null || meanDiff(sig, lastSig) > 9) {  // distinct screen
          kept.push(canvas.toDataURL("image/jpeg", 0.85));
          lastSig = sig.slice(0);
        }
        if (onProgress) onProgress(++i / times.length);
      }

      let frames = kept;
      if (frames.length > maxFrames) {            // keep evenly spaced subset
        const out = [], step = frames.length / maxFrames;
        for (let k = 0; k < maxFrames; k++) out.push(frames[Math.floor(k * step)]);
        frames = out;
      }
      if (!frames.length) throw new Error("No frames could be extracted.");
      return frames.map((d) => ({ media_type: "image/jpeg", data: d.split(",")[1] }));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function seek(v, t) {
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      v.onseeked = fin;
      try { v.currentTime = Math.min(t, v.duration || t); } catch { fin(); }
      setTimeout(fin, 1500);
    });
  }
  function meanDiff(a, b) {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) { s += Math.abs(a[i] - b[i]); n++; }
    return s / n;
  }

  return { extract };
})();
