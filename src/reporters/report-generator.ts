import path from "node:path";
import type { RunArtifactLayout } from "../artifacts/artifact-manager.js";
import type { PluginManager } from "../plugins/plugin-manager.js";
import type { ReportFormat, RunReport } from "../types/index.js";
import { HtmlReporter } from "./html/html-reporter.js";
import { JsonReporter } from "./json/json-reporter.js";
import { JUnitReporter } from "./junit/junit-reporter.js";

export interface GeneratedReportPaths {
  html?: string;
  json?: string;
  junit?: string;
  topLevelHtml?: string;
  topLevelJson?: string;
  topLevelJunit?: string;
  custom: string[];
}

export class ReportGenerator {
  private readonly jsonReporter = new JsonReporter();
  private readonly junitReporter = new JUnitReporter();
  private readonly htmlReporter = new HtmlReporter();

  async generate(
    report: RunReport,
    layout: RunArtifactLayout,
    formats: ReportFormat[],
    pluginManager?: PluginManager,
  ): Promise<GeneratedReportPaths> {
    const formatSet = new Set(formats);
    const paths: GeneratedReportPaths = { custom: [] };

    if (formatSet.has("json")) {
      paths.json = await this.jsonReporter.write(report, path.join(layout.runDir, "report.json"));
      paths.topLevelJson = await this.jsonReporter.write(
        report,
        path.join(layout.baseReportDir, "report.json"),
      );
    }

    if (formatSet.has("junit")) {
      paths.junit = await this.junitReporter.write(report, path.join(layout.runDir, "junit.xml"));
      paths.topLevelJunit = await this.junitReporter.write(
        report,
        path.join(layout.baseReportDir, "junit.xml"),
      );
    }

    if (formatSet.has("html")) {
      paths.html = await this.htmlReporter.write(report, path.join(layout.runDir, "report.html"));
      const relPrefix = `runs/${layout.runId}/`;
      paths.topLevelHtml = await this.htmlReporter.write(
        report,
        path.join(layout.baseReportDir, "report.html"),
        { artifactBasePrefix: relPrefix },
      );
    }

    if (pluginManager) {
      for (const reporter of pluginManager.getReporters()) {
        try {
          const out = await reporter.generate(report, layout.runDir);
          if (typeof out === "string") {
            paths.custom.push(out);
          }
        } catch {
          // Isolate custom reporter failures
        }
      }
    }

    return paths;
  }
}
