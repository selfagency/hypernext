import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/bin.ts",
        "src/commands/**",
        "src/database/entities/**",
        "src/database/mikro-orm.config.ts",
        "src/database/schema.sql",
        "src/lib/**",
        "src/parser/ir.ts",
        "src/types/**",
      ],
      thresholds: {
        statements: 79,
        branches: 63,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    singleFork: true,
  },
});
