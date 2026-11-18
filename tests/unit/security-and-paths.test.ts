import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PathSafetyError,
  REDACTED,
  Redactor,
  assertPathWithin,
  assertSafeReportDirectory,
  escapeHtml,
  escapeXml,
  parseDurationString,
  safeJsonForHtml,
  sanitizeFileSlug,
  sanitizeParsedObject,
} from "../../src/index.js";

describe("Security Redaction (A25)", () => {
  it("redacts URL credentials and query params while respecting allowlist", () => {
    const redactor = new Redactor({
      redactQueryParams: true,
      allowedQueryParams: ["page"],
    });
    const out = redactor.redactUrl(
      "https://admin:supersecret@example.com/api/items?page=2&token=abc123&api_key=xyz",
    );
    expect(out).not.toContain("supersecret");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("xyz");
    expect(out).toContain("page=2");
    expect(out).toContain("token=%5BREDACTED%5D");
  });

  it("redacts Authorization, Cookie, and custom headers", () => {
    const redactor = new Redactor({ redactHeaders: ["x-internal-secret"] });
    const headers = redactor.redactHeaders({
      Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc1234567890.sig1234567890",
      Cookie: "session_id=topsecret",
      "X-Internal-Secret": "my-secret",
      "Content-Type": "application/json",
    });

    expect(headers.Authorization).toBe(REDACTED);
    expect(headers.Cookie).toBe(REDACTED);
    expect(headers["X-Internal-Secret"]).toBe(REDACTED);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("redacts JWTs, Bearer tokens, and secret key-value patterns in free text", () => {
    const redactor = new Redactor();
    const input =
      "Failed call with Authorization: Bearer tok_secret_99999 and api_key=my_secret_value_123";
    const out = redactor.redactText(input);
    expect(out).not.toContain("tok_secret_99999");
    expect(out).not.toContain("my_secret_value_123");
    expect(out).toContain(REDACTED);
  });

  it("escapes HTML, XML, and script breakouts in JSON", () => {
    expect(escapeHtml(`<script>alert("xss")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
    expect(escapeXml(`a & "b" < 'c'`)).toBe("a &amp; &quot;b&quot; &lt; &apos;c&apos;");
    const embedded = safeJsonForHtml({ title: "</script><img src=x onerror=alert(1)>" });
    expect(embedded).not.toContain("</script>");
    expect(embedded).toContain("\\u003c/script\\u003e");
  });

  it("strips __proto__, constructor, and prototype keys", () => {
    const parsed = JSON.parse('{"ok":1,"__proto__":{"polluted":true},"nested":{"constructor":"x"}}');
    const clean = sanitizeParsedObject(parsed) as Record<string, unknown>;
    expect(clean.ok).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(clean, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clean.nested as object, "constructor")).toBe(false);
  });
});

describe("Path Safety & Duration Parsing", () => {
  it("prevents directory traversal outside baseDir", () => {
    const base = path.resolve("/tmp/offlinelab-safe-test");
    expect(assertPathWithin(base, "runs/run-1")).toBe(path.join(base, "runs/run-1"));
    expect(() => assertPathWithin(base, "../etc/passwd")).toThrow(PathSafetyError);
    expect(() => assertPathWithin(base, "/etc/passwd")).toThrow(PathSafetyError);
    expect(() => assertPathWithin(base, ".")).toThrow(PathSafetyError);
  });

  it("refuses unsafe cleanup targets (root, home, project cwd)", () => {
    const cwd = path.resolve("/tmp/my-project");
    expect(() => assertSafeReportDirectory("/", cwd)).toThrow(PathSafetyError);
    expect(() => assertSafeReportDirectory(os.homedir(), cwd)).toThrow(PathSafetyError);
    expect(() => assertSafeReportDirectory(".", cwd)).toThrow(PathSafetyError);
    expect(assertSafeReportDirectory("./offlinelab-results", cwd)).toBe(
      path.join(cwd, "offlinelab-results"),
    );
  });

  it("sanitizes arbitrary file slugs safely", () => {
    const slug = sanitizeFileSlug("../../Weird Name! @#$.png");
    expect(slug).not.toContain("..");
    expect(slug).not.toContain("/");
    expect(slug.startsWith(".")).toBe(false);
    expect(slug).toBe("weird-name-.png");
    expect(sanitizeFileSlug("   ", "fallback")).toBe("fallback");
  });

  it("parses duration strings accurately", () => {
    expect(parseDurationString("14d")).toBe(14 * 86_400_000);
    expect(parseDurationString("2h")).toBe(7_200_000);
    expect(parseDurationString("30m")).toBe(1_800_000);
    expect(parseDurationString("invalid")).toBeUndefined();
  });
});
