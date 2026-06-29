/* Claude vision: extract structured run data from screenshots.

   Calls the Anthropic Messages API directly from the browser using the user's
   own key (stored locally) + the dangerous-direct-browser-access header, which
   Anthropic provides specifically for keyless-backend / personal apps. */
const AI = (() => {
  const ENDPOINT = "https://api.anthropic.com/v1/messages";

  // JSON schema for one consolidated run (nulls allowed where unknown).
  const SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      date: { type: ["string", "null"], description: "ISO date YYYY-MM-DD if visible" },
      title: { type: ["string", "null"] },
      distanceKm: { type: ["number", "null"] },
      durationSec: { type: ["number", "null"], description: "total moving/elapsed time in seconds" },
      avgHr: { type: ["integer", "null"] },
      maxHr: { type: ["integer", "null"] },
      intervals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: ["string", "null"] },
            distanceKm: { type: ["number", "null"] },
            durationSec: { type: ["number", "null"] },
            avgHr: { type: ["integer", "null"] },
            paceSecPerKm: { type: ["number", "null"] },
          },
          required: ["label", "distanceKm", "durationSec", "avgHr", "paceSecPerKm"],
        },
      },
      notes: { type: ["string", "null"] },
    },
    required: ["date", "title", "distanceKm", "durationSec", "avgHr", "maxHr", "intervals", "notes"],
  };

  const PROMPT =
    "These screenshots are from a running watch or app and together describe ONE run " +
    "(summary stats, heart rate, and/or lap/interval splits). Extract the data. " +
    "Convert all distances to kilometres and all times to seconds. If splits/laps are " +
    "shown, fill the intervals array (one entry per lap). Use null for anything not shown — " +
    "do not guess. Return only the structured object.";

  // files: File[] (images). Returns the parsed run object.
  async function extractFromImages(files) {
    const key = Settings.apiKey();
    if (!key) throw new Error("No API key set. Add your Anthropic key in ⚙ Settings.");
    if (!files.length) throw new Error("Add at least one screenshot.");

    const images = await Promise.all([...files].map(toImageBlock));
    const body = {
      model: CONFIG.claudeModel,
      max_tokens: 2048,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [...images, { type: "text", text: PROMPT }] }],
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      let msg = `Claude API error (${res.status})`;
      try { msg = JSON.parse(txt).error?.message || msg; } catch {}
      throw new Error(msg);
    }
    const json = await res.json();
    const text = (json.content || []).find((b) => b.type === "text")?.text || "{}";
    return JSON.parse(text);
  }

  function toImageBlock(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result).split(",")[1]; // strip data: prefix
        resolve({
          type: "image",
          source: { type: "base64", media_type: file.type || "image/png", data },
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return { extractFromImages };
})();
