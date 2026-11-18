import fs from "node:fs/promises";
import path from "node:path";
import { escapeXml } from "../../security/redactor.js";
import type { RunReport } from "../../types/index.js";

export class JUnitReporter {
  serialize(report: RunReport): string {
    const totalTests = report.scenarios.length;
    const failures = report.scenarios.filter((s) => s.status === "failed").length;
    const skipped = report.scenarios.filter(
      (s) => s.status === "skipped" || s.status === "unsupported",
    ).length;
    const totalTimeSec = (report.durationMs / 1000).toFixed(3);

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites name="OfflineLab" tests="${totalTests}" failures="${failures}" skipped="${skipped}" time="${totalTimeSec}">`,
      `  <testsuite name="${escapeXml(report.runId)}" tests="${totalTests}" failures="${failures}" skipped="${skipped}" time="${totalTimeSec}" timestamp="${escapeXml(report.startedAt)}">`,
    ];

    for (const scenario of report.scenarios) {
      const timeSec = (scenario.durationMs / 1000).toFixed(3);
      const className = `offlinelab.${scenario.browser}.${scenario.mode}`;
      lines.push(
        `    <testcase classname="${escapeXml(className)}" name="${escapeXml(scenario.name)}" time="${timeSec}">`,
      );

      if (scenario.flaky || scenario.attempts > 1) {
        lines.push("      <properties>");
        if (scenario.flaky) {
          lines.push('        <property name="flaky" value="true" />');
        }
        lines.push(`        <property name="attempts" value="${scenario.attempts}" />`);
        lines.push("      </properties>");
      }

      if (scenario.status === "failed") {
        const message = scenario.error?.message ?? scenario.reason ?? "Scenario failed";
        const type = scenario.error?.code ?? scenario.error?.name ?? "AssertionFailure";
        const details: string[] = [];
        for (const a of scenario.assertions.filter((x) => x.status === "failed")) {
          details.push(`Assertion failed: ${a.name}: ${a.message ?? ""}`);
        }
        if (scenario.error?.stack) {
          details.push(scenario.error.stack);
        }
        lines.push(
          `      <failure message="${escapeXml(message)}" type="${escapeXml(type)}">${escapeXml(details.join("\n"))}</failure>`,
        );
      } else if (scenario.status === "skipped" || scenario.status === "unsupported") {
        const reason =
          scenario.reason ??
          (scenario.status === "unsupported"
            ? `Unsupported capability on ${scenario.browser}`
            : "Scenario skipped");
        lines.push(
          `      <skipped type="${escapeXml(scenario.status)}" message="${escapeXml(reason)}" />`,
        );
      }

      if (scenario.consoleErrors.length > 0) {
        const errText = scenario.consoleErrors
          .map((e) => `[${e.type}] ${e.text}`)
          .join("\n");
        lines.push(`      <system-err>${escapeXml(errText)}</system-err>`);
      }

      lines.push("    </testcase>");
    }

    lines.push("  </testsuite>");
    lines.push("</testsuites>");
    return lines.join("\n") + "\n";
  }

  async write(report: RunReport, outputPath: string): Promise<string> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const xml = this.serialize(report);
    await fs.writeFile(outputPath, xml, "utf8");
    return outputPath;
  }
}
