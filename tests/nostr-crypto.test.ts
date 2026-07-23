import { describe, expect, it } from "vitest";
import { decryptNsec, encryptNsec } from "../src/federation/nostr/crypto";

describe("nostr-crypto", () => {
  const testSecretBytes = new TextEncoder().encode(
    "nsec1testsecretkey123456789012345678901234567890"
  );
  const testJwtSecret = "test-jwt-secret-for-encryption";

  describe("encryptNsec", () => {
    it("should encrypt nsec Uint8Array to base64", () => {
      const encrypted = encryptNsec(testSecretBytes, testJwtSecret);
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should produce different ciphertext for same input (random IV)", () => {
      const encrypted1 = encryptNsec(testSecretBytes, testJwtSecret);
      const encrypted2 = encryptNsec(testSecretBytes, testJwtSecret);
      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe("decryptNsec", () => {
    it("should decrypt encrypted nsec back to original Uint8Array", () => {
      const encrypted = encryptNsec(testSecretBytes, testJwtSecret);
      const decrypted = decryptNsec(encrypted, testJwtSecret);
      expect(decrypted).toBeInstanceOf(Uint8Array);
      const decryptedStr = new TextDecoder().decode(decrypted);
      expect(decryptedStr).toBe(
        "nsec1testsecretkey123456789012345678901234567890"
      );
    });

    it("should throw for invalid ciphertext", () => {
      expect(() => decryptNsec("invalid-base64", testJwtSecret)).toThrow();
    });

    it("should throw for wrong jwt secret", () => {
      const encrypted = encryptNsec(testSecretBytes, testJwtSecret);
      expect(() => decryptNsec(encrypted, "wrong-secret")).toThrow();
    });
  });
});
