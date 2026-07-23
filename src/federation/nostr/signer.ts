import { finalizeEvent, getPublicKey } from "nostr-tools";
import type { NostrSyndicationConfig } from "../../types/config.js";
import { decryptNsec } from "./crypto.js";

export interface NostrSigner {
  getPublicKey(): string;
  kind: "nsec" | "nip46";
  signEvent(
    eventTemplate: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/ban-types
  signEventSync?(
    eventTemplate: Record<string, unknown>
  ): Record<string, unknown>;
}

/**
 * Signer backed by a server-held nsec (encrypted at rest).
 * The nsec is decrypted at construction time — callers should
 * create this inside a piscina worker, not in the main process.
 */
export class NsecSigner implements NostrSigner {
  readonly kind = "nsec" as const;
  readonly #seckey: Uint8Array;
  readonly #pubkey: string;

  constructor(seckey: Uint8Array) {
    this.#seckey = seckey;
    this.#pubkey = getPublicKey(seckey);
  }

  getPublicKey(): string {
    return this.#pubkey;
  }

  signEvent(
    eventTemplate: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return Promise.resolve(this.signEventSync(eventTemplate));
  }

  signEventSync(
    eventTemplate: Record<string, unknown>
  ): Record<string, unknown> {
    const result = finalizeEvent(
      eventTemplate as Parameters<typeof finalizeEvent>[0],
      this.#seckey
    );
    // Convert VerifiedEvent to generic Record
    return { ...result } as Record<string, unknown>;
  }
}

/**
 * Signer backed by a NIP-46 remote signer (bunker).
 * Connects to the bunker's relay and uses NIP-04-encrypted
 * requests to sign events remotely.
 */
export class Nip46Signer implements NostrSigner {
  readonly kind = "nip46" as const;
  readonly #pubkey: string;

  constructor(_bunkerUri: string, pubkey: string) {
    this.#pubkey = pubkey;
  }

  getPublicKey(): string {
    return this.#pubkey;
  }

  signEvent(
    _eventTemplate: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // NIP-46 requires opening a WebSocket to the bunker's relay,
    // sending a NIP-04-encrypted sign_event request, and waiting
    // for the signed event response.
    throw new Error(
      "NIP-46 signer not yet implemented — use nsec signer or provide a bunker URI via the CLI wizard"
    );
  }
}

/**
 * Create a signer from the given config.
 * For nsec mode, the jwtSecret is required to decrypt the nsec.
 * For nip46 mode, the bunker URI is used to establish a remote signing session.
 *
 * NOTE: This function should only be called inside a piscina worker
 * or a dedicated CLI command — never in the main HTTP request handler.
 */
export function createSigner(
  config: NostrSyndicationConfig,
  ctx: { jwtSecret: string }
): NostrSigner {
  if (config.signer.type === "nsec") {
    const seckey = decryptNsec(config.signer.encryptedNsec, ctx.jwtSecret);
    return new NsecSigner(seckey);
  }
  // For nip46, we'd connect to the bunker, derive the pubkey from the
  // initial connection response, and create a Nip46Signer.
  throw new Error("NIP-46 signer not yet implemented");
}

/**
 * Derive the hex pubkey from the config without decrypting the nsec
 * in the main process. This is a lightweight helper that can be called
 * from the main process for display purposes (e.g., `nostr inspect` CLI).
 */
export function getNostrAuthorPubkey(
  config: NostrSyndicationConfig
): string | undefined {
  if (config.signer.type === "nsec") {
    // We can't decrypt the nsec here (main process), so we return undefined.
    // The pubkey should be cached/cli-derived instead.
    return;
  }
  // For nip46, return undefined until connected
  return;
}
