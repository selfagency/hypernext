import { describe, expect, it, vi } from "vitest";
import type { HypernextConfig } from "../src/types/config.js";
import { initLogger, logger } from "../src/utils/logger.js";

describe("logger", () => {
  it("logs at info level by default", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({} as HypernextConfig);
    logger.info("test message");
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toContain("test message");
    spy.mockRestore();
  });

  it("logs at error level to console.error", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({} as HypernextConfig);
    logger.error("error message");
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toContain("error message");
    spy.mockRestore();
  });

  it("filters messages below configured level", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({
      logging: { level: "warn", format: "pretty", maskSecrets: false },
    } as HypernextConfig);
    logger.info("should not appear");
    expect(logs.length).toBe(0);
    spy.mockRestore();
  });

  it("outputs JSON format when configured", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({
      logging: { level: "info", format: "json", maskSecrets: false },
    } as HypernextConfig);
    logger.info("json test");
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(logs[0] ?? "{}");
    expect(parsed.msg).toBe("json test");
    expect(parsed.level).toBe("info");
    spy.mockRestore();
  });

  it("masks secrets in messages when configured", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({
      logging: { level: "info", format: "json", maskSecrets: true },
    } as HypernextConfig);
    logger.info('{"password":"secret123"}');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(logs[0] ?? "{}");
    expect(parsed.msg).toContain("***");
    expect(parsed.msg).not.toContain("secret123");
    spy.mockRestore();
  });

  it("masks secrets in metadata when configured", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({
      logging: { level: "info", format: "json", maskSecrets: true },
    } as HypernextConfig);
    logger.info("test", { token: "my-secret-token" });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(logs[0] ?? "{}");
    expect(parsed.token).toBe("***");
    spy.mockRestore();
  });

  it("supports all log levels", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(msg);
    });
    initLogger({
      logging: { level: "trace", format: "json", maskSecrets: false },
    } as HypernextConfig);
    logger.trace("trace msg");
    logger.debug("debug msg");
    logger.info("info msg");
    expect(logs.length).toBe(3);
    spy.mockRestore();
  });
});
