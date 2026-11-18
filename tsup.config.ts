import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node22",
    splitting: false,
    treeshake: true,
    external: ["playwright", "jiti", "fast-glob", "yaml", "zod", "commander", "@clack/prompts", "picocolors"],
  },
  {
    entry: {
      cli: "src/cli/index.ts",
    },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node22",
    splitting: false,
    treeshake: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: ["playwright", "jiti", "fast-glob", "yaml", "zod", "commander", "@clack/prompts", "picocolors"],
  },
]);
