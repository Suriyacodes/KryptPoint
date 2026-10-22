/* KryptPoint UI configuration. Change the API base URL here only. */
window.KRYPTPOINT_CONFIG = {
  // FastAPI backend base URL, no trailing slash.
  API_BASE_URL: "http://172.18.229.55:8000",

  // Client-side validation only; the backend is the source of truth.
  // ASSUMPTION: confirm accepted formats and size limit with the backend team.
  ACCEPTED_TYPES: ["image/jpeg", "image/png", "image/webp"],
  MAX_FILE_MB: 10,
  MAX_REPORT_MB: 20,

  REQUEST_TIMEOUT_MS: 60000,

  // Set true only if the backend explicitly documents `score` as a calibrated probability.
  SCORE_IS_CALIBRATED: false,
};
