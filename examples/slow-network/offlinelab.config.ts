import { defineConfig } from "../../src/index.js";

export default defineConfig({
  baseURL: "http://localhost:4173",
  browsers: ["chromium"],
  scenarios: ["scenarios/**/*.yaml"],
  mode: "auto",
  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json"],
  },
});
