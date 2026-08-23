import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./tests/setupTests.ts"],
      globals: false,
      exclude: ["node_modules", "dist", "tests/e2e/**"],
      // Phase 1 (Setup) intentionally ships with zero test files; later phases add them.
      // Without this, `vitest run` exits 1 on an empty suite by design.
      passWithNoTests: true,
    },
  }),
);
