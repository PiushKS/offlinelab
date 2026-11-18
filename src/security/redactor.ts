import type { RedactionConfig } from "../types/index.js";

const DEFAULT_SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-session-token",
  "x-access-token",
]);

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
  /(Basic\s+)[A-Za-z0-9+/=]+/gi,
  /\b(sk_live_|sk_test_|pk_live_|pk_test_|ghp_|gho_|github_pat_|xoxb-|xoxp-|AIza)[A-Za-z0-9_-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|passwd|session[_-]?id)\s*[=:]\s*)([^\s&;,"']+)/gi,
];

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const REDACTED = "[REDACTED]";

export class Redactor {
  private readonly redactQueryParams: boolean;
  private readonly allowedQueryParams: Set<string>;
  private readonly sensitiveHeaders: Set<string>;
  private readonly secretRegexes: RegExp[];
  private readonly customReplacer?: (input: string) => string;

  constructor(config?: Partial<RedactionConfig>) {
    this.redactQueryParams = config?.redactQueryParams ?? true;
    this.allowedQueryParams = new Set(
      (config?.allowedQueryParams ?? []).map((p) => p.toLowerCase()),
    );
    this.sensitiveHeaders = new Set([
      ...DEFAULT_SENSITIVE_HEADERS,
      ...(config?.redactHeaders ?? []).map((h) => h.toLowerCase()),
    ]);
    this.secretRegexes = [...DEFAULT_SECRET_PATTERNS];
    for (const pattern of config?.secretPatterns ?? []) {
      try {
        this.secretRegexes.push(new RegExp(pattern, "gi"));
      } catch {
        // Ignore invalid user regex patterns safely without crashing redaction
      }
    }
    this.customReplacer = config?.customReplacer;
  }

  redactUrl(rawUrl: string): string {
    if (!rawUrl) return rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.username) {
        parsed.username = REDACTED;
      }
      if (parsed.password) {
        parsed.password = REDACTED;
      }
      if (this.redactQueryParams && parsed.searchParams.size > 0) {
        const keys = Array.from(parsed.searchParams.keys());
        for (const key of keys) {
          if (!this.allowedQueryParams.has(key.toLowerCase())) {
            parsed.searchParams.set(key, REDACTED);
          }
        }
      }
      return this.redactText(parsed.toString());
    } catch {
      // Fallback for relative URLs or non-standard URLs
      if (this.redactQueryParams && rawUrl.includes("?")) {
        const [base, query] = rawUrl.split("?", 2);
        if (query) {
          const redactedQuery = query
            .split("&")
            .map((pair) => {
              const eqIdx = pair.indexOf("=");
              if (eqIdx === -1) return pair;
              const k = pair.slice(0, eqIdx);
              if (this.allowedQueryParams.has(k.toLowerCase())) {
                return pair;
              }
              return `${k}=${REDACTED}`;
            })
            .join("&");
          return this.redactText(`${base}?${redactedQuery}`);
        }
      }
      return this.redactText(rawUrl);
    }
  }

  redactHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (this.sensitiveHeaders.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = this.redactText(value);
      }
    }
    return out;
  }

  redactText(input: string): string {
    if (!input) return input;
    let result = input;
    for (const regex of this.secretRegexes) {
      regex.lastIndex = 0;
      result = result.replace(regex, (...args) => {
        // If regex has a prefix capturing group + secret value, preserve prefix
        if (args.length >= 4 && typeof args[1] === "string" && typeof args[2] === "string") {
          return `${args[1]}${REDACTED}`;
        }
        if (args.length >= 3 && typeof args[1] === "string" && /^(Bearer|Basic)\s+/i.test(args[1])) {
          return `${args[1]}${REDACTED}`;
        }
        return REDACTED;
      });
    }
    if (this.customReplacer) {
      result = this.customReplacer(result);
    }
    return result;
  }

  redactObject<T>(value: T, maxDepth = 8): T {
    const seen = new WeakSet<object>();

    const walk = (node: unknown, depth: number): unknown => {
      if (depth > maxDepth) return "[TRUNCATED]";
      if (typeof node === "string") return this.redactText(node);
      if (node === null || typeof node !== "object") return node;
      if (seen.has(node)) return "[CIRCULAR]";
      seen.add(node);

      if (Array.isArray(node)) {
        return node.map((item) => walk(item, depth + 1));
      }

      const obj: Record<string, unknown> = Object.create(null);
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        const lower = k.toLowerCase();
        if (
          this.sensitiveHeaders.has(lower) ||
          lower.includes("password") ||
          lower.includes("secret") ||
          lower.includes("token") ||
          lower.includes("apikey") ||
          lower.includes("api_key") ||
          lower === "cookie" ||
          lower === "authorization"
        ) {
          obj[k] = REDACTED;
        } else if (lower === "url" && typeof v === "string") {
          obj[k] = this.redactUrl(v);
        } else {
          obj[k] = walk(v, depth + 1);
        }
      }
      return { ...obj };
    };

    return walk(value, 0) as T;
  }
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Strips prototype-pollution keys recursively from parsed JSON/YAML objects.
 */
export function sanitizeParsedObject<T>(input: T): T {
  if (input === null || typeof input !== "object") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeParsedObject(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    clean[key] = sanitizeParsedObject(value);
  }
  return clean as T;
}
