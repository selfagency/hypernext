import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
    // In tsx dev mode, skip Piscina entirely. tsx's resolver hooks redirect
    // Worker thread module resolution to outDir paths that don't exist.
    const isTsx = process.execArgv.some((a) => a.includes("tsx"));
    if (isTsx) {
      console.warn(
        "Worker pool: disabled in tsx dev mode (background jobs run inline)"
      );
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: piscina types are dynamically imported
    const Piscina: any = (await import("piscina")).default;

    // Construct the processor entry path relative to the project root.
    // tsx rewrites import.meta.url to the outDir, breaking relative URL
    // resolution. Using process.cwd() gives us a consistent anchor.
    const PROJECT_ROOT = process.cwd();
    const srcEntry = resolve(PROJECT_ROOT, "src/jobs/processors/index.ts");
    const distEntry = resolve(PROJECT_ROOT, "dist/jobs/processors/index.js");
    const processorEntry = existsSync(srcEntry) ? srcEntry : distEntry;
    console.error("[worker] using processor:", processorEntry);

    pool = new Piscina({
      filename: processorEntry,
      execArgv: process.execArgv, // pass tsx hooks to worker threads in dev
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
