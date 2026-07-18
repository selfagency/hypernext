import { afterAll, beforeAll } from "vitest";

// Global test setup — runs before all tests
beforeAll(() => {
  // Set test environment variables
  process.env.HYPERNEXT_DB_PATH = ":memory:";
});

afterAll(() => {
  // Cleanup after all tests
});
