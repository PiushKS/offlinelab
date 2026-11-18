import { ConfigValidationError } from "../core/errors/index.js";
import type { EventListener } from "../core/events/event-recorder.js";
import type { NetworkProfileRegistry } from "../network/profiles/registry.js";
import type {
  CustomAssertionDefinition,
  CustomReporterDefinition,
  NetworkProfileConfig,
  OfflineLabEvent,
  OfflineLabPlugin,
  PluginAPI,
} from "../types/index.js";

export class PluginManager {
  private readonly loadedPlugins: OfflineLabPlugin[] = [];
  private readonly pluginNames = new Set<string>();
  private readonly customAssertions = new Map<string, CustomAssertionDefinition>();
  private readonly customReporters = new Map<string, CustomReporterDefinition>();
  private readonly eventListeners: EventListener[] = [];
  private readonly registeredProfiles: NetworkProfileConfig[] = [];

  async loadPlugins(
    plugins: OfflineLabPlugin[] | undefined,
    profileRegistry?: NetworkProfileRegistry,
  ): Promise<void> {
    if (!plugins || plugins.length === 0) return;

    for (const plugin of plugins) {
      if (!plugin || typeof plugin.name !== "string" || plugin.name.trim().length === 0) {
        throw new ConfigValidationError("Every OfflineLab plugin must specify a non-empty `name`.");
      }
      if (this.pluginNames.has(plugin.name)) {
        throw new ConfigValidationError(
          `Duplicate plugin registration detected: "${plugin.name}".`,
          { plugin: plugin.name },
        );
      }
      if (typeof plugin.setup !== "function") {
        throw new ConfigValidationError(
          `Plugin "${plugin.name}" must implement a \`setup(api)\` function.`,
        );
      }

      const api: PluginAPI = {
        registerAssertion: (assertion) => {
          if (!assertion.name || typeof assertion.execute !== "function") {
            throw new ConfigValidationError(
              `Plugin "${plugin.name}" attempted to register an invalid custom assertion.`,
            );
          }
          if (this.customAssertions.has(assertion.name)) {
            throw new ConfigValidationError(
              `Custom assertion "${assertion.name}" is already registered (conflict from plugin "${plugin.name}").`,
            );
          }
          this.customAssertions.set(assertion.name, assertion);
        },

        registerNetworkProfile: (profile) => {
          this.registeredProfiles.push(profile);
          profileRegistry?.register(profile);
        },

        registerReporter: (reporter) => {
          if (!reporter.name || typeof reporter.generate !== "function") {
            throw new ConfigValidationError(
              `Plugin "${plugin.name}" attempted to register an invalid custom reporter.`,
            );
          }
          if (this.customReporters.has(reporter.name)) {
            throw new ConfigValidationError(
              `Custom reporter "${reporter.name}" is already registered (conflict from plugin "${plugin.name}").`,
            );
          }
          this.customReporters.set(reporter.name, reporter);
        },

        onEvent: (listener) => {
          this.eventListeners.push((event: OfflineLabEvent) => {
            try {
              const res = listener(event);
              if (res && typeof (res as Promise<void>).catch === "function") {
                return (res as Promise<void>).catch(() => {
                  // Isolate plugin event listener errors
                });
              }
            } catch {
              // Isolate synchronous plugin errors
            }
          });
        },
      };

      try {
        await plugin.setup(api);
        this.pluginNames.add(plugin.name);
        this.loadedPlugins.push(plugin);
      } catch (err) {
        if (err instanceof ConfigValidationError) throw err;
        throw new ConfigValidationError(
          `Plugin "${plugin.name}" failed during setup(): ${(err as Error).message}`,
          { plugin: plugin.name },
        );
      }
    }
  }

  getAssertion(name: string): CustomAssertionDefinition | undefined {
    return this.customAssertions.get(name);
  }

  listAssertions(): CustomAssertionDefinition[] {
    return Array.from(this.customAssertions.values());
  }

  getReporters(): CustomReporterDefinition[] {
    return Array.from(this.customReporters.values());
  }

  getEventListeners(): EventListener[] {
    return [...this.eventListeners];
  }

  getRegisteredProfiles(): NetworkProfileConfig[] {
    return [...this.registeredProfiles];
  }

  async teardown(): Promise<void> {
    for (const plugin of this.loadedPlugins) {
      if (typeof plugin.teardown === "function") {
        try {
          await plugin.teardown();
        } catch {
          // Isolate teardown errors so remaining plugins still clean up
        }
      }
    }
    this.loadedPlugins.length = 0;
    this.pluginNames.clear();
  }
}
