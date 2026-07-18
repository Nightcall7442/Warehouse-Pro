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
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 30,
        statements: 50,
      },
    },
  },
});
