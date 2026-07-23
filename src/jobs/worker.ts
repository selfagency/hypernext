import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claimNext, markComplete, markFailed, markRetry } from "./queue.js";

// biome-ignore lint/suspicious/noExplicitAny: piscina types are dynamically imported
let pool: any = null;

const POLL_INTERVAL_MS = 500;
const MAX_RETRY_DELAY_MS = 60_000;

export async function startWorkerPool(
  _configPath: string,
  _dbPath: string
): Promise<void> {
  if (pool) {
    return;
  }

  // Skip piscina pool during tests — Vitest can't compile workers on the fly
  if (typeof process !== "undefined" && process.env.VITEST) {
    return;
  }

  try {
    // biome-ignore lint/suspicious/noExplicitAny: piscina types are dynamically imported
    const Piscina: any = (await import("piscina")).default;

    // The processor entry runs in a separate Worker thread. Resolve the path
    // for both source and dist layouts — whichever actually exists.
    //   - source (tsx dev):   dist/commands/ depends on dist/worker-XXXX.js
    //     → import.meta.url = dist/worker-XXXX.js
    //   - built (node dist):  same layout
    //   - direct (tsx src):   src/jobs/worker.ts
    //     → import.meta.url = src/jobs/worker.ts
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(moduleDir, "processors/index.ts"), // src/jobs/ in tsx dev
      resolve(moduleDir, "processors/index.js"), // dist/ when flattened
      resolve(moduleDir, "jobs/processors/index.js"), // dist/jobs/ when preserved
      resolve(process.cwd(), "dist/jobs/processors/index.js"), // project-root fallback
    ];
    const processorEntry = candidates.find(existsSync);
    if (!processorEntry) {
      throw new Error(
        `Cannot find processor entry (tried:\n  ${candidates.join("\n  ")})`
      );
    }

    pool = new Piscina({
      filename: processorEntry,
      execArgv: process.execArgv,
      maxThreads: 1,
      idleTimeout: 30_000,
    });

    // Worker thread errors (e.g. module resolution failures inside the pool)
    // are emitted as 'error' events. Catch them to avoid unhandled rejections
    // crashing the process.
    pool.on("error", (err: Error) => {
      console.warn(`Worker thread error: ${err.message}`);
    });
    pollLoop();
  } catch (err) {
    console.warn(
      `Worker pool initialization failed (background jobs disabled): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function pollLoop(): void {
  setTimeout(async () => {
    try {
      const job = await claimNext();
      if (job && pool) {
        const payload = JSON.parse(job.payload);
        pool
          .run({ id: job.id, type: job.type, payload })
          .then(async (result: unknown) => {
            await markComplete(job.id, result ? { result } : undefined);
          })
          .catch(async (err: Error) => {
            if (job.attempts < job.maxAttempts) {
              const delay = Math.min(
                1000 * 2 ** (job.attempts - 1),
                MAX_RETRY_DELAY_MS
              );
              await markRetry(job.id, new Date(Date.now() + delay));
            } else {
              await markFailed(job.id, err.message);
            }
          });
      }
    } catch {
      // Poll failures are non-fatal
    }
    pollLoop();
  }, POLL_INTERVAL_MS);
}

export function stopWorkerPool(): void {
  if (pool) {
    pool.destroy();
    pool = null;
  }
}
