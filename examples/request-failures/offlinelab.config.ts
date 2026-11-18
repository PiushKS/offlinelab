import { defineConfig } from "../../src/index.js";

export default defineConfig({
  baseURL: "http://localhost:4173",
  browsers: ["chromium"],
  scenarios: ["scenarios/**/*.yaml"],
  mode: "interception",
  serviceWorkers: "block",
  workers: 1,
  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json"],
  },
});
