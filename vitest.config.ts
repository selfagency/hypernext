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
        "src/database/entities/**",
        "src/database/mikro-orm.config.ts",
        "src/database/schema.sql",
        "src/federation/ai-tasks.ts",
        "src/federation/email-tasks.ts",
        "src/jobs/worker.ts",
        "src/lib/**",
        "src/parser/ir.ts",
        "src/sync/**",
        "src/types/**",
      ],
      thresholds: {
        // TODO: Raise thresholds to 80% once Nostr/Waline/federated-comments features mature
        statements: 70,
        branches: 55,
        functions: 74,
        lines: 70,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    singleFork: true,
  },
});
