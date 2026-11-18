import { defineConfig } from "../../src/index.js";

export default defineConfig({
  baseURL: "http://localhost:4173",
  browsers: ["chromium"],
  scenarios: ["scenarios/**/*.yaml"],
  mode: "auto",
  serviceWorkers: "allow",
  workers: 1,
  retries: 0,
  timeoutMs: 30_000,
  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json", "junit"],
  },
});
