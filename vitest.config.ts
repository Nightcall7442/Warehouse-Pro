import { defineConfig } from "vitest/config";
import path from "path";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@":          path.resolve(root, "src"),
      "@contracts": path.resolve(root, "contracts"),
      "@db":        path.resolve(root, "db"),
      "db":         path.resolve(root, "db"),
    },
  },
  test: {
    environment: "node",
    include:     ["api/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["api/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["api/__tests__/**", "api/**/*.test.ts", "src/**/*.test.ts"],
      // FIX: P1.5 — floors set just below the current numbers so `npm test` is a
      // real regression gate. They were 50/50/30/50, which nothing has ever met,
      // so the test job failed on every run and the signal was ignored. Raise
      // these as coverage grows; do not lower them.
      thresholds: {
        lines: 37,
        functions: 39,
        branches: 27,
        statements: 36,
      },
    },
  },
});
