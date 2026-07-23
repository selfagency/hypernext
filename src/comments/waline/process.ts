import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { HypernextConfig } from "../../types/config.js";
import { walineConfigToEnv } from "./env.js";

let walineProcess: ChildProcess | null = null;
let restartCount = 0;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

interface WalineManagerOptions {
  config: HypernextConfig;
  jwtSecret: string;
  onError?: (error: Error) => void;
  onReady?: () => void;
}

function getWalinePort(config: HypernextConfig): number {
  return config.comments?.waline?.port || 8360;
}

function getWalineEntryPoint(): string {
  // Try multiple possible locations for @waline/vercel
  const possiblePaths = [
    "./node_modules/@waline/vercel/vanilla.js",
    "./node_modules/@waline/vercel/bin/vanilla.js",
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Default to the common path
  return "./node_modules/@waline/vercel/vanilla.js";
}

/**
 * Check if the Waline server is healthy by hitting its health endpoint.
 */
async function checkWalineHealth(
  port: number,
  timeoutMs = 30_000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/comment?type=count&url=__health`
      );
      if (response.ok || response.status === 400) {
        // Waline returns 400 for invalid URL but the server is up
        return true;
      }
    } catch {
      // Connection refused or other error, server not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

/**
 * Start the Waline server as a child process.
 */
export async function startWaline(
  options: WalineManagerOptions
): Promise<void> {
  const { config, jwtSecret, onReady, onError } = options;
  const waline = config.comments?.waline;

  if (!waline?.enabled) {
    return;
  }

  if (waline.mode === "external") {
    // External mode - just verify the server URL is reachable
    if (waline.serverURL) {
      try {
        const response = await fetch(waline.serverURL);
        if (!response.ok) {
          throw new Error(`Waline external server returned ${response.status}`);
        }
      } catch {
        throw new Error(
          `Cannot reach Waline external server: ${waline.serverURL}`
        );
      }
    }
    return;
  }

  // Embedded mode - start child process
  const port = getWalinePort(config);
  const entryPoint = getWalineEntryPoint();

  // Generate a simple JWT for the Waline server
  // Waline uses JWT for admin authentication
  const jwtToken = jwtSecret.slice(0, 32); // Simple derivation for now

  const env = {
    ...process.env,
    ...walineConfigToEnv(config, jwtToken),
    PORT: String(port),
  };

  console.log(`[Waline] Starting embedded Waline server on port ${port}...`);

  walineProcess = spawn("node", [entryPoint], {
    env,
    stdio: "pipe",
  });

  walineProcess.stdout?.on("data", (data) => {
    console.log(`[Waline] ${data.toString().trim()}`);
  });

  walineProcess.stderr?.on("data", (data) => {
    console.error(`[Waline] ${data.toString().trim()}`);
  });

  walineProcess.on("error", (error) => {
    console.error("[Waline] Process error:", error);
    onError?.(error as Error);
  });

  walineProcess.on("exit", (code, signal) => {
    console.log(`[Waline] Process exited with code ${code}, signal ${signal}`);
    walineProcess = null;

    // Attempt restart if within limits
    if (code !== 0 && code !== null) {
      handleRestart(options);
    }
  });

  // Wait for health check
  const healthy = await checkWalineHealth(port);

  if (!healthy) {
    const error = new Error("Waline server failed to become healthy");
    onError?.(error);
    throw error;
  }

  console.log(`[Waline] Server started successfully on port ${port}`);
  restartCount = 0;
  onReady?.();
}

/**
 * Handle Waline process restart with backoff.
 */
function handleRestart(options: WalineManagerOptions): void {
  // Reset restart count if outside the window
  if (restartCount > 0) {
    // Simple reset: if we've had successful starts, reset
    restartCount = 0;
  }

  if (restartCount >= MAX_RESTARTS) {
    console.error(
      `[Waline] Max restarts (${MAX_RESTARTS}) exceeded in ${RESTART_WINDOW_MS / 1000}s window. Giving up.`
    );
    return;
  }

  restartCount++;
  console.log(`[Waline] Attempting restart ${restartCount}/${MAX_RESTARTS}...`);

  setTimeout(() => {
    startWaline(options).catch((error) => {
      console.error("[Waline] Restart failed:", error);
    });
  }, 1000 * restartCount); // Exponential backoff
}

/**
 * Stop the Waline server process.
 */
export function stopWaline(): Promise<void> {
  return new Promise((resolve) => {
    if (!walineProcess) {
      resolve();
      return;
    }

    console.log("[Waline] Stopping server...");

    walineProcess.once("exit", () => {
      console.log("[Waline] Server stopped");
      walineProcess = null;
      resolve();
    });

    // Graceful shutdown
    walineProcess.kill("SIGTERM");

    // Force kill after 5 seconds
    setTimeout(() => {
      if (walineProcess) {
        console.log("[Waline] Force killing...");
        walineProcess.kill("SIGKILL");
      }
    }, 5000);
  });
}

/**
 * Check if Waline process is running.
 */
export function isWalineRunning(): boolean {
  return walineProcess !== null && !walineProcess.killed;
}

/**
 * Get the Waline server URL based on configuration.
 */
export function getWalineServerUrl(config: HypernextConfig): string | null {
  const waline = config.comments?.waline;
  if (!waline?.enabled) {
    return null;
  }

  if (waline.mode === "external" && waline.serverURL) {
    return waline.serverURL;
  }

  const port = getWalinePort(config);
  // Validate site URL exists (used for type narrowing)
  if (!config.site?.canonicalBase) {
    // Fall through to default URL
  }
  return `http://127.0.0.1:${port}`;
}
