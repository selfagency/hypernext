import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const HKDF_SALT = "hypernext-nostr-nsec";
const HKDF_INFO = "aes-key";

/**
 * Derive an AES-256-GCM key from jwtSecret using HKDF-SHA256.
 */
function deriveKey(jwtSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(jwtSecret, "utf-8"),
      Buffer.from(HKDF_SALT),
      Buffer.from(HKDF_INFO),
      KEY_LENGTH
    )
  );
}

/**
 * Encrypt a raw nsec (Uint8Array) using AES-256-GCM.
 * Output format: base64(iv ‖ ciphertext ‖ tag)
 */
export function encryptNsec(nsec: Uint8Array, jwtSecret: string): string {
  const key = deriveKey(jwtSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(nsec)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypt an encrypted nsec (base64 iv‖ciphertext‖tag) using AES-256-GCM.
 * Throws on invalid jwtSecret (GCM auth tag mismatch).
 */
export function decryptNsec(encrypted: string, jwtSecret: string): Uint8Array {
  const key = deriveKey(jwtSecret);
  const raw = Buffer.from(encrypted, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(raw.length - TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
