import { getEm } from "../database/index.js";
import { claimNext, markComplete, markFailed, markRetry } from "./queue.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Piscina: any = (await import("piscina")).default;
    pool = new Piscina({
      filename: new URL("./processors/index.js", import.meta.url).href,
      maxThreads: 1,
      idleTimeout: 30_000,
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
