import fs from "node:fs/promises";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { ConfigValidationError } from "../../core/errors/index.js";

export type InitTemplate = "web" | "pwa" | "api";

export interface InitCommandOptions {
  yes?: boolean;
  template?: string;
  url?: string;
  force?: boolean;
  cwd?: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(cwd: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  if (await fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(cwd, "yarn.lock"))) return "yarn";
  if (await fileExists(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

function generateConfigContent(baseURL: string, template: InitTemplate): string {
  const mode = template === "pwa" ? "pwa" : template === "api" ? "interception" : "auto";
  const sw = template === "api" ? "block" : "allow";

  return `import { defineConfig } from "offlinelab";

export default defineConfig({
  baseURL: ${JSON.stringify(baseURL)},

  browsers: ["chromium"],

  scenarios: [
    "scenarios/**/*.yaml",
    "scenarios/**/*.ts"
  ],

  mode: ${JSON.stringify(mode)},
  serviceWorkers: ${JSON.stringify(sw)},

  workers: 2,
  retries: 0,
  timeoutMs: 30000,

  reports: {
    directory: "./offlinelab-results",
    formats: ["html", "json", "junit"]
  }
});
`;
}

function generateScenariosForTemplate(template: InitTemplate): Array<{ filename: string; content: string }> {
  if (template === "pwa") {
    return [
      {
        filename: "offline-navigation.yaml",
        content: `name: offline-navigation
description: Verify cached PWA navigation after Service Worker activation
mode: pwa
browser: chromium

steps:
  - action: navigate
    path: /

  - action: waitForServiceWorker
    controlled: true
    timeoutMs: 15000

  - action: navigate
    path: /

  - action: setNetwork
    profile: offline

  - action: reload

  - action: expectVisible
    selector: "body"

  - action: screenshot
    name: offline-home

  - action: setNetwork
    profile: online
`,
      },
      {
        filename: "reconnect-sync.yaml",
        content: `name: reconnect-sync
description: Verify application survives offline transition and restores online connectivity
mode: pwa
browser: chromium

steps:
  - action: navigate
    path: /

  - action: waitForServiceWorker
    controlled: true
    timeoutMs: 15000

  - action: inspectCache

  - action: setOffline

  - action: markTimelineEvent
    label: "Offline state entered"

  - action: wait
    durationMs: 1000
    reason: "Allow UI to react to offline event"

  - action: screenshot
    name: offline-state

  - action: setOnline

  - action: expectVisible
    selector: "body"
`,
      },
    ];
  }

  if (template === "api") {
    return [
      {
        filename: "api-500-resilience.yaml",
        content: `name: api-500-resilience
description: Verify application handles HTTP 500 API failures without crashing
mode: interception
browser: chromium

steps:
  - action: navigate
    path: /

  - action: injectFailure
    id: api-500
    url: "**/api/**"
    fault: http-500

  - action: markTimelineEvent
    label: "HTTP 500 fault injected on /api/**"

  - action: expectVisible
    selector: "body"

  - action: screenshot
    name: api-500-state

  - action: removeFailure
    id: api-500
`,
      },
      {
        filename: "api-slow-latency.yaml",
        content: `name: api-slow-latency
description: Verify application remains usable when API responses are delayed
mode: interception
browser: chromium

steps:
  - action: navigate
    path: /

  - action: delayRequests
    id: api-delay
    url: "**/api/**"
    delayMs: 1200

  - action: expectVisible
    selector: "body"

  - action: removeFailure
    id: api-delay
`,
      },
    ];
  }

  // Default: "web"
  return [
    {
      filename: "offline-resilience.yaml",
      content: `name: offline-resilience
description: Verify application handles disconnection and reconnects cleanly
mode: auto
browser: chromium

steps:
  - action: navigate
    path: /

  - action: expectVisible
    selector: "body"

  - action: setOffline

  - action: markTimelineEvent
    label: "Browser switched offline"

  - action: screenshot
    name: offline-view

  - action: setOnline

  - action: reload

  - action: expectVisible
    selector: "body"
`,
    },
    {
      filename: "slow-network.yaml",
      content: `name: slow-network
description: Verify page loads reliably under slow-3g network conditions
mode: auto
browser: chromium

steps:
  - action: setNetwork
    profile: slow-3g

  - action: navigate
    path: /

  - action: expectVisible
    selector: "body"

  - action: screenshot
    name: slow-3g-loaded

  - action: setNetwork
    profile: online
`,
    },
  ];
}

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY && !options.yes);

  let template: InitTemplate = "web";
  if (options.template) {
    if (options.template !== "web" && options.template !== "pwa" && options.template !== "api") {
      throw new ConfigValidationError(
        `Invalid init template "${options.template}". Expected one of: web, pwa, api.`,
      );
    }
    template = options.template;
  }

  let baseURL = options.url ?? "http://localhost:3000";
  const pm = await detectPackageManager(cwd);
  const hasPkgJson = await fileExists(path.join(cwd, "package.json"));

  if (isInteractive) {
    prompts.intro(pc.bold("OfflineLab: Project Setup"));

    if (!options.template) {
      const selected = await prompts.select({
        message: "Which project template would you like to initialize?",
        options: [
          { value: "web", label: "Web application", hint: "General offline & slow-network checks" },
          { value: "pwa", label: "Progressive Web App (PWA)", hint: "Service Worker, cache & offline navigation" },
          { value: "api", label: "API fault resilience", hint: "HTTP 500, delays & request interception" },
        ],
      });
      if (prompts.isCancel(selected)) {
        prompts.cancel("Initialization cancelled.");
        return;
      }
      template = selected as InitTemplate;
    }

    if (!options.url) {
      const urlAnswer = await prompts.text({
        message: "What is your local application base URL?",
        initialValue: baseURL,
        validate: (val) => {
          try {
            new URL(val);
            return undefined;
          } catch {
            return "Please enter a valid URL (e.g. http://localhost:3000)";
          }
        },
      });
      if (prompts.isCancel(urlAnswer)) {
        prompts.cancel("Initialization cancelled.");
        return;
      }
      baseURL = String(urlAnswer);
    }
  } else {
    try {
      new URL(baseURL);
    } catch {
      throw new ConfigValidationError(`Invalid --url value: "${baseURL}".`);
    }
  }

  const configPath = path.join(cwd, "offlinelab.config.ts");
  const scenariosDir = path.join(cwd, "scenarios");
  const scenarios = generateScenariosForTemplate(template);

  const plannedFiles = [
    { target: configPath, content: generateConfigContent(baseURL, template) },
    ...scenarios.map((s) => ({
      target: path.join(scenariosDir, s.filename),
      content: s.content,
    })),
  ];

  const existingFiles: string[] = [];
  for (const item of plannedFiles) {
    if (await fileExists(item.target)) {
      existingFiles.push(path.relative(cwd, item.target));
    }
  }

  if (existingFiles.length > 0 && !options.force) {
    if (isInteractive) {
      const overwrite = await prompts.confirm({
        message: `These files already exist (${existingFiles.join(", ")}). Overwrite them?`,
        initialValue: false,
      });
      if (prompts.isCancel(overwrite) || !overwrite) {
        prompts.cancel("Skipped overwriting existing files. Re-run with --force to replace them.");
        return;
      }
    } else {
      throw new ConfigValidationError(
        `Refusing to overwrite existing files: ${existingFiles.join(", ")}.`,
        { existingFiles },
        "Pass --force to overwrite existing OfflineLab configuration and scenario files.",
      );
    }
  }

  if (existingFiles.length > 0 && options.force) {
    console.warn(
      pc.yellow(`Warning: --force enabled; overwriting ${existingFiles.join(", ")}.`),
    );
  }

  await fs.mkdir(scenariosDir, { recursive: true });
  for (const item of plannedFiles) {
    await fs.writeFile(item.target, item.content, "utf8");
  }

  const runPrefix = pm === "pnpm" ? "pnpm exec" : pm === "yarn" ? "yarn" : pm === "bun" ? "bunx" : "npx";
  const createdRel = plannedFiles.map((f) => path.relative(cwd, f.target));

  if (isInteractive) {
    prompts.note(
      [
        `Detected package manager: ${pm}${hasPkgJson ? " (package.json found)" : ""}`,
        "",
        "Created files:",
        ...createdRel.map((f) => `  - ${f}`),
        "",
        "Next steps:",
        `  1. Verify environment:  ${runPrefix} offlinelab doctor`,
        `  2. Validate scenarios:  ${runPrefix} offlinelab scenario validate`,
        `  3. Run tests:           ${runPrefix} offlinelab run`,
      ].join("\n"),
      "OfflineLab initialized",
    );
    prompts.outro("Ready to test offline resilience.");
  } else {
    console.log("Initialized OfflineLab project:");
    for (const f of createdRel) {
      console.log(`  created ${f}`);
    }
    console.log("");
    console.log("Next steps:");
    console.log(`  1. ${runPrefix} offlinelab doctor`);
    console.log(`  2. ${runPrefix} offlinelab scenario validate`);
    console.log(`  3. ${runPrefix} offlinelab run`);
  }
}
