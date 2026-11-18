# Plugin Architecture

OfflineLab supports lightweight, explicitly configured local plugins. Plugins are **never** auto-discovered from `node_modules`; they must be explicitly listed in `offlinelab.config.ts` or `new OfflineLab({ plugins: [...] })`.

## Writing a Plugin

```ts
import type { OfflineLabPlugin } from "offlinelab";

export const customNetworkPlugin: OfflineLabPlugin = {
  name: "custom-network-check",
  version: "1.0.0",

  setup(api) {
    api.registerNetworkProfile({
      name: "rural-edge",
      offline: false,
      latencyMs: 1400,
      downloadKbps: 120,
      uploadKbps: 40,
      failureRate: 0.1,
      seed: 7,
    });

    api.registerAssertion({
      name: "assert-sw-controlled",
      async execute(ctx) {
        const sw = await ctx.inspectServiceWorker();
        if (!sw.controlled) {
          throw new Error("Expected page to be controlled by a Service Worker");
        }
      },
    });

    api.onEvent((event) => {
      if (event.type === "fault.injected") {
        // Observe injected faults
      }
    });
  },
};
```

## Plugin Guarantees

- Duplicate plugin names, duplicate custom assertion names, and duplicate custom reporter names throw `ConfigValidationError`.
- Event listener and custom reporter exceptions are isolated so they do not corrupt test teardown.
- `teardown()` is called cleanly during runner shutdown.
