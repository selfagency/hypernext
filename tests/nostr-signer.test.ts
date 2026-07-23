import { describe, expect, it } from "vitest";
import {
  createSigner,
  getNostrAuthorPubkey,
  Nip46Signer,
  NsecSigner,
} from "../src/federation/nostr/signer";

describe("NostrSigner exports", () => {
  it("should export NsecSigner class", () => {
    expect(NsecSigner).toBeDefined();
  });

  it("should export Nip46Signer class", () => {
    expect(Nip46Signer).toBeDefined();
  });

  it("should export createSigner function", () => {
    expect(typeof createSigner).toBe("function");
  });

  it("should export getNostrAuthorPubkey function", () => {
    expect(typeof getNostrAuthorPubkey).toBe("function");
  });
});
