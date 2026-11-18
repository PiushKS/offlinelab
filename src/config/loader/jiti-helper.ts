import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

function resolveSelfEntryPath(): string | undefined {
  const currentFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(currentFile);

  for (let i = 0; i < 6; i++) {
    const distIndex = path.join(dir, "dist", "index.js");
    const directIndex = path.join(dir, "index.js");
    const srcIndex = path.join(dir, "src", "index.ts");
    const pkgJson = path.join(dir, "package.json");

    if (fs.existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { name?: string };
        if (pkg.name === "offlinelab") {
          if (fs.existsSync(distIndex)) return distIndex;
          if (fs.existsSync(srcIndex)) return srcIndex;
        }
      } catch {
        // continue
      }
    }

    if (path.basename(dir) === "dist" && fs.existsSync(directIndex)) {
      return directIndex;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

export function createOfflineLabJiti() {
  const selfEntry = resolveSelfEntryPath();
  return createJiti(import.meta.url, {
    interopDefault: true,
    moduleCache: false,
    ...(selfEntry ? { alias: { offlinelab: selfEntry } } : {}),
  });
}
