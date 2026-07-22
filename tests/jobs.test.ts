import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrm, getEm, initOrm } from "../src/database/index.js";
import { initJobsTable, schedule } from "../src/jobs/queue.js";

beforeAll(async () => {
  await initOrm(":memory:");
  await initJobsTable();
});

afterAll(async () => {
  await closeOrm();
});

describe("job queue", () => {
  it("schedules a job and returns an id", async () => {
    const id = await schedule("test", { foo: "bar" });
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
  });

  it("schedules a job with idempotency key", async () => {
    const id = await schedule(
      "test",
      { foo: "bar" },
      { idempotencyKey: "dup-key" }
    );
    expect(id).toBe("dup-key");
  });

  it("returns existing id for duplicate idempotency key", async () => {
    const id1 = await schedule(
      "test",
      { foo: "bar" },
      { idempotencyKey: "dup-key-2" }
    );
    const id2 = await schedule(
      "test",
      { baz: "qux" },
      { idempotencyKey: "dup-key-2" }
    );
    expect(id1).toBe(id2);
  });

  it("schedules a job with maxAttempts", async () => {
    const id = await schedule("test", {}, { maxAttempts: 5 });
    expect(id).toBeDefined();
    const em = getEm();
    const rows = await em
      .getConnection()
      .execute<{ max_attempts: number }[]>(
        "SELECT max_attempts FROM jobs WHERE id = ?",
        [id]
      );
    expect(rows[0]?.max_attempts).toBe(5);
  });

  it("schedules a job with future scheduledAt", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const id = await schedule("test", {}, { scheduledAt: future });
    expect(id).toBeDefined();
  });
});
