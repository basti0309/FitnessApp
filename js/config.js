/* App configuration.

   To enable Google Drive cross-device sync, paste your Google OAuth Client ID
   below (created in Google Cloud Console — it is NOT a secret and is safe in
   public client-side code). Leave empty to run with local-only storage. */
const CONFIG = {
  googleClientId: "",            // e.g. "1234-abc.apps.googleusercontent.com"
  driveFileName: "wodbox-data.json",
  claudeModel: "claude-opus-4-8",
};
