import { defineConfig } from "vitepress";

export default defineConfig({
  title: "OfflineLab",
  description: "Break the network. Not your app. Offline and network resilience testing for web apps and PWAs.",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "API", link: "/api/cli" },
      { text: "Examples", link: "/examples/" },
      { text: "Limitations", link: "/limitations" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "Installation", link: "/guide/installation" },
          { text: "Quick Start", link: "/guide/quick-start" },
          { text: "Configuration", link: "/guide/configuration" },
        ],
      },
      {
        text: "Testing Guides",
        items: [
          { text: "Scenarios (YAML & TS)", link: "/guide/scenarios" },
          { text: "Network Profiles", link: "/guide/network-profiles" },
          { text: "Fault Injection", link: "/guide/fault-injection" },
          { text: "PWA & Service Workers", link: "/guide/pwa-testing" },
          { text: "Storage & Sync Testing", link: "/guide/storage-testing" },
          { text: "CI Integration", link: "/guide/ci-integration" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI Reference", link: "/api/cli" },
          { text: "TypeScript SDK", link: "/api/sdk" },
          { text: "Events & Reports", link: "/api/events" },
          { text: "Plugin Architecture", link: "/api/plugins" },
        ],
      },
      {
        text: "More",
        items: [
          { text: "Runnable Examples", link: "/examples/" },
          { text: "Troubleshooting", link: "/troubleshooting" },
          { text: "Limitations & Browser Matrix", link: "/limitations" },
          { text: "Contributing", link: "/contributing" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/PiushKS/offlinelab" },
    ],
  },
});
