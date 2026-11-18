export const ExitCode = {
  SUCCESS: 0,
  ASSERTION_FAILURE: 1,
  INVALID_CONFIG: 2,
  INFRASTRUCTURE_ERROR: 3,
  INTERRUPTED: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class OfflineLabError extends Error {
  public readonly code: string;
  public readonly exitCode: ExitCodeValue;
  public readonly suggestion?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      exitCode: ExitCodeValue;
      suggestion?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OfflineLabError";
    this.code = options.code;
    this.exitCode = options.exitCode;
    this.suggestion = options.suggestion;
    this.details = options.details;
  }
}

export class ConfigValidationError extends OfflineLabError {
  constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, {
      code: "CONFIG_VALIDATION_ERROR",
      exitCode: ExitCode.INVALID_CONFIG,
      suggestion:
        suggestion ??
        "Check your offlinelab.config.ts or CLI options and run `offlinelab doctor` to verify configuration.",
      details,
    });
    this.name = "ConfigValidationError";
  }
}

export class ScenarioValidationError extends OfflineLabError {
  constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, {
      code: "SCENARIO_VALIDATION_ERROR",
      exitCode: ExitCode.INVALID_CONFIG,
      suggestion:
        suggestion ??
        "Run `offlinelab scenario validate` to inspect schema errors in your scenario files.",
      details,
    });
    this.name = "ScenarioValidationError";
  }
}

export class BrowserLaunchError extends OfflineLabError {
  constructor(
    message: string,
    browser: string,
    cause?: unknown,
    suggestion?: string,
  ) {
    super(message, {
      code: "BROWSER_LAUNCH_ERROR",
      exitCode: ExitCode.INFRASTRUCTURE_ERROR,
      suggestion:
        suggestion ??
        `Ensure the Playwright ${browser} browser binary is installed by running: npx playwright install ${browser}`,
      details: { browser },
      cause,
    });
    this.name = "BrowserLaunchError";
  }
}

export class UnsupportedCapabilityError extends OfflineLabError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    suggestion?: string,
  ) {
    super(message, {
      code: "UNSUPPORTED_CAPABILITY",
      exitCode: ExitCode.ASSERTION_FAILURE,
      suggestion:
        suggestion ??
        "Run this scenario on Chromium or configure `unsupportedPolicy: 'skip'` if cross-browser execution is intended.",
      details,
    });
    this.name = "UnsupportedCapabilityError";
  }
}

export class AssertionFailedError extends OfflineLabError {
  public readonly expected?: unknown;
  public readonly actual?: unknown;

  constructor(
    message: string,
    options?: { expected?: unknown; actual?: unknown; suggestion?: string; cause?: unknown },
  ) {
    super(message, {
      code: "ASSERTION_FAILED",
      exitCode: ExitCode.ASSERTION_FAILURE,
      suggestion: options?.suggestion,
      details: {
        expected: options?.expected,
        actual: options?.actual,
      },
      cause: options?.cause,
    });
    this.name = "AssertionFailedError";
    this.expected = options?.expected;
    this.actual = options?.actual;
  }
}

export class TimeoutError extends OfflineLabError {
  constructor(message: string, timeoutMs: number, suggestion?: string, cause?: unknown) {
    super(message, {
      code: "TIMEOUT_ERROR",
      exitCode: ExitCode.ASSERTION_FAILURE,
      suggestion:
        suggestion ??
        `Increase the timeout (currently ${timeoutMs}ms) or check whether the target element, Service Worker, or server is responding.`,
      details: { timeoutMs },
      cause,
    });
    this.name = "TimeoutError";
  }
}

export class InfrastructureError extends OfflineLabError {
  constructor(message: string, suggestion?: string, cause?: unknown, details?: Record<string, unknown>) {
    super(message, {
      code: "INFRASTRUCTURE_ERROR",
      exitCode: ExitCode.INFRASTRUCTURE_ERROR,
      suggestion,
      details,
      cause,
    });
    this.name = "InfrastructureError";
  }
}

export class PathSafetyError extends OfflineLabError {
  constructor(message: string, targetPath: string) {
    super(message, {
      code: "PATH_SAFETY_ERROR",
      exitCode: ExitCode.INVALID_CONFIG,
      suggestion:
        "Ensure artifact and cleanup paths stay within the configured report directory.",
      details: { targetPath },
    });
    this.name = "PathSafetyError";
  }
}

export function mapErrorToExitCode(error: unknown): ExitCodeValue {
  if (error instanceof OfflineLabError) {
    return error.exitCode;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return ExitCode.INTERRUPTED;
  }
  return ExitCode.INFRASTRUCTURE_ERROR;
}

export function formatErrorForUser(error: unknown, debug = false): string {
  if (error instanceof OfflineLabError) {
    const lines = [`Error [${error.code}]: ${error.message}`];
    if (error.suggestion) {
      lines.push(`Hint: ${error.suggestion}`);
    }
    if (debug && error.stack) {
      lines.push(error.stack);
    }
    return lines.join("\n");
  }
  if (error instanceof Error) {
    const lines = [`Error: ${error.message}`];
    if (debug && error.stack) {
      lines.push(error.stack);
    }
    return lines.join("\n");
  }
  return `Error: ${String(error)}`;
}
