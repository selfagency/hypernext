import { describe, expect, it } from "vitest";
import { validateSourceUrl } from "../src/federation/ssrf";

describe("SSRF protection", () => {
  it("accepts valid HTTPS URL", () => {
    expect(validateSourceUrl("https://example.com")).toBe(true);
  });

  it("accepts valid HTTP URL", () => {
    expect(validateSourceUrl("http://example.com")).toBe(true);
  });

  it("rejects localhost hostname", () => {
    expect(validateSourceUrl("http://localhost")).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(validateSourceUrl("http://127.0.0.1")).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    expect(validateSourceUrl("http://0.0.0.0")).toBe(false);
  });

  it("rejects ::1", () => {
    expect(validateSourceUrl("http://[::1]")).toBe(false);
  });

  it("rejects 10.x.x.x private IP", () => {
    expect(validateSourceUrl("http://10.0.0.1")).toBe(false);
    expect(validateSourceUrl("http://10.255.255.255")).toBe(false);
  });

  it("rejects 192.168.x.x private IP", () => {
    expect(validateSourceUrl("http://192.168.1.1")).toBe(false);
    expect(validateSourceUrl("http://192.168.0.0")).toBe(false);
  });

  it("rejects 172.16-31.x.x private IP", () => {
    expect(validateSourceUrl("http://172.16.0.1")).toBe(false);
    expect(validateSourceUrl("http://172.31.255.255")).toBe(false);
    // 172.32 is not private
    expect(validateSourceUrl("http://172.32.0.1")).toBe(true);
  });

  it("rejects private IPv6 (fc00::/7)", () => {
    expect(validateSourceUrl("http://[fc00::]")).toBe(false);
    expect(validateSourceUrl("http://[fd00::1]")).toBe(false);
  });

  it("rejects non-HTTP schemes", () => {
    expect(validateSourceUrl("ftp://example.com")).toBe(false);
    expect(validateSourceUrl("file:///etc/passwd")).toBe(false);
    expect(validateSourceUrl("data:text/plain,hello")).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(validateSourceUrl("")).toBe(false);
    expect(validateSourceUrl("not-a-url")).toBe(false);
  });
});
