import net from "node:net";
import tls from "node:tls";
import { e2e } from "./setup.js";

export function waitForWorkmatic(timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeout) {
        reject(new Error("Timeout waiting for job queue to drain"));
        return;
      }
      // Jobs are processed by the piscina worker pool which doesn't run in
      // test mode. We wait a reasonable delay for enqueue operations to settle.
      setTimeout(resolve, 500);
    };
    check();
  });
}

export function tcpRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.connect(port, "localhost", () => {
      client.write(request);
    });
    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString("utf-8");
    });
    client.on("end", () => resolve(data));
    client.on("error", reject);
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("TCP request timeout"));
    });
  });
}

export function tlsRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = tls.connect(
      { port, host: "localhost", rejectUnauthorized: false },
      () => {
        client.write(request);
      }
    );
    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString("utf-8");
    });
    client.on("end", () => resolve(data));
    client.on("error", reject);
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("TLS request timeout"));
    });
  });
}

export function apiUrl(path: string): string {
  return `http://localhost:${e2e.httpPort}${path}`;
}

export function apiHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${e2e.apiKey}` };
}
