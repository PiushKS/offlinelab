import { defineConfig } from "../../src/index.js";

export default defineConfig({
  baseURL: "http://localhost:4173",
  browsers: ["chromium"],
  scenarios: ["scenarios/**/*.ts"],
  mode: "pwa",
  serviceWorkers: "allow",
  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json", "junit"],
  },
});
