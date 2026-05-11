import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "vite-plus/test": "vitest",
    },
  },
});
