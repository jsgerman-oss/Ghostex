import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  /**
   * CDXC:NativeOnlyCleanup 2026-05-05-02:22
   * Storybook now covers the native/shared sidebar UI only. The old VS Code
   * workspace webview was removed with the unused extension terminal backend.
   */
  stories: ["../sidebar/**/*.stories.@(ts|tsx)"],
  viteFinal: async (config) => {
    const existingPlugins = config.plugins ?? [];
    config.resolve = {
      ...config.resolve,
      alias: {
        ...(Array.isArray(config.resolve?.alias) ? {} : config.resolve?.alias),
        "@": path.resolve(storybookDir, ".."),
      },
    };
    config.plugins = [
      ...existingPlugins,
      {
        name: "ghostex-current-sidebar-settings",
        configureServer(server) {
          server.middlewares.use("/__ghostex-current-sidebar-settings", (_request, response) => {
            const settingsPath = path.join(
              os.homedir(),
              ".ghostex",
              "state",
              "native-sidebar-settings.json",
            );
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            try {
              /**
               * CDXC:StorybookSettings 2026-05-08-16:45
               * Local sidebar scenarios must reproduce the user's running ghostex
               * chrome before visual regression checks. Storybook serves the
               * shared native settings snapshot read-only so fixtures can use
               * the same sidebar mode, width, theme, and visibility settings
               * as the app instead of stale hard-coded harness defaults.
               */
              response.end(fs.readFileSync(settingsPath, "utf8"));
            } catch {
              response.end("{}");
            }
          });
        },
      },
    ];

    return config;
  },
};

export default config;
