import path from "node:path";
import { PathSafetyError } from "../core/errors/index.js";

/**
 * Ensures `targetPath` resolves strictly inside `baseDir` (or equals `baseDir` when `allowEqual` is true).
 */
export function assertPathWithin(
  baseDir: string,
  targetPath: string,
  allowEqual = false,
): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, targetPath);

  if (resolvedTarget === resolvedBase) {
    if (allowEqual) {
      return resolvedTarget;
    }
    throw new PathSafetyError(
      `Refusing to operate on base directory itself: ${resolvedTarget}`,
      resolvedTarget,
    );
  }

  const relative = path.relative(resolvedBase, resolvedTarget);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new PathSafetyError(
      `Path escapes allowed directory (${resolvedBase}): ${targetPath}`,
      resolvedTarget,
    );
  }

  return resolvedTarget;
}

/**
 * Converts an arbitrary label or scenario name into a safe filesystem slug.
 */
export function sanitizeFileSlug(input: string, fallback = "artifact"): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/\.{2,}/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);

  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Validates that a cleanup target directory is a plausible OfflineLab report directory
 * (never filesystem root, home directory, or parent directory).
 */
export function assertSafeReportDirectory(reportDir: string, cwd: string): string {
  const resolved = path.resolve(cwd, reportDir);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new PathSafetyError("Refusing to clean filesystem root directory.", resolved);
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir && path.resolve(homeDir) === resolved) {
    throw new PathSafetyError("Refusing to clean user home directory.", resolved);
  }
  if (path.resolve(cwd) === resolved) {
    throw new PathSafetyError(
      "Refusing to clean project root directory directly; configure a dedicated report subdirectory such as './offlinelab-results'.",
      resolved,
    );
  }
  return resolved;
}
