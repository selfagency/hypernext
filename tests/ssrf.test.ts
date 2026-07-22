import { describe, expect, it } from "vitest";
import { validateSourceUrl } from "../src/federation/ssrf";

describe("SSRF protection", () => {
  it("accepts valid HTTPS URL", async () => {
    await expect(validateSourceUrl("https://example.com")).resolves.toBe(true);
  });

  it("accepts valid HTTP URL", async () => {
    await expect(validateSourceUrl("http://example.com")).resolves.toBe(true);
  });

  it("rejects localhost hostname", async () => {
    await expect(validateSourceUrl("http://localhost")).resolves.toBe(false);
  });

  it("rejects 127.0.0.1", async () => {
    await expect(validateSourceUrl("http://127.0.0.1")).resolves.toBe(false);
  });

  it("rejects 0.0.0.0", async () => {
    await expect(validateSourceUrl("http://0.0.0.0")).resolves.toBe(false);
  });

  it("rejects ::1", async () => {
    await expect(validateSourceUrl("http://[::1]")).resolves.toBe(false);
  });

  it("rejects 10.x.x.x private IP", async () => {
    await expect(validateSourceUrl("http://10.0.0.1")).resolves.toBe(false);
    await expect(validateSourceUrl("http://10.255.255.255")).resolves.toBe(
      false
    );
  });

  it("rejects 192.168.x.x private IP", async () => {
    await expect(validateSourceUrl("http://192.168.1.1")).resolves.toBe(false);
    await expect(validateSourceUrl("http://192.168.0.0")).resolves.toBe(false);
  });

  it("rejects 172.16-31.x.x private IP", async () => {
    await expect(validateSourceUrl("http://172.16.0.1")).resolves.toBe(false);
    await expect(validateSourceUrl("http://172.31.255.255")).resolves.toBe(
      false
    );
    await expect(validateSourceUrl("http://172.32.0.1")).resolves.toBe(true);
  });

  it("rejects private IPv6 (fc00::/7)", async () => {
    await expect(validateSourceUrl("http://[fc00::]")).resolves.toBe(false);
    await expect(validateSourceUrl("http://[fd00::1]")).resolves.toBe(false);
  });

  it("rejects non-HTTP schemes", async () => {
    await expect(validateSourceUrl("ftp://example.com")).resolves.toBe(false);
    await expect(validateSourceUrl("file:///etc/passwd")).resolves.toBe(false);
    await expect(validateSourceUrl("data:text/plain,hello")).resolves.toBe(
      false
    );
  });

  it("rejects malformed URL", async () => {
    await expect(validateSourceUrl("")).resolves.toBe(false);
    await expect(validateSourceUrl("not-a-url")).resolves.toBe(false);
  });

  // ── New blocklist coverage ──

  it("rejects link-local (169.254.x.x) including AWS metadata", async () => {
    await expect(
      validateSourceUrl("http://169.254.169.254/latest/meta-data/")
    ).resolves.toBe(false);
  });

  it("rejects CGNAT (100.64.x.x – 100.127.x.x)", async () => {
    await expect(validateSourceUrl("http://100.64.0.1")).resolves.toBe(false);
    await expect(validateSourceUrl("http://100.127.255.255")).resolves.toBe(
      false
    );
    // 100.128 is not CGNAT
    await expect(validateSourceUrl("http://100.128.0.1")).resolves.toBe(true);
  });

  it("rejects entire 0.x.x.x range", async () => {
    await expect(validateSourceUrl("http://0.0.0.1")).resolves.toBe(false);
    await expect(validateSourceUrl("http://0.255.255.255")).resolves.toBe(
      false
    );
  });

  it("rejects IPv6 link-local (fe80::/10)", async () => {
    await expect(validateSourceUrl("http://[fe80::1]")).resolves.toBe(false);
    await expect(validateSourceUrl("http://[feb0::1]")).resolves.toBe(false);
  });

  it("rejects IPv6 unspecified (::)", async () => {
    await expect(validateSourceUrl("http://[::]")).resolves.toBe(false);
    await expect(validateSourceUrl("http://[0:0:0:0:0:0:0:0]/")).resolves.toBe(
      false
    );
  });

  it("rejects IPv4-mapped IPv6 (::ffff:127.0.0.1)", async () => {
    await expect(validateSourceUrl("http://[::ffff:127.0.0.1]/")).resolves.toBe(
      false
    );
    await expect(validateSourceUrl("http://[::ffff:10.0.0.1]/")).resolves.toBe(
      false
    );
  });
});
