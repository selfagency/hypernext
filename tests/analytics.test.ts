import { describe, expect, it } from "vitest";
import { hashVisitor } from "../src/analytics/stats-manager.js";

describe("analytics", () => {
  describe("hashVisitor", () => {
    it("produces consistent hash for same IP on same day", () => {
      const h1 = hashVisitor("192.168.1.1");
      const h2 = hashVisitor("192.168.1.1");
      expect(h1).toBe(h2);
    });

    it("produces different hashes for different IPs", () => {
      const h1 = hashVisitor("192.168.1.1");
      const h2 = hashVisitor("10.0.0.1");
      expect(h1).not.toBe(h2);
    });

    it("returns a string of reasonable length", () => {
      const hash = hashVisitor("127.0.0.1");
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(5);
    });
  });
});
