import { createInterface } from "node:readline/promises";
import { generateSecretKey } from "nostr-tools";
import { DEFAULT_CONFIG_PATH, getConfig } from "../../config.js";
import { encryptNsec } from "../../federation/nostr/crypto.js";
import BaseCommand from "../../lib/base-command.js";

const SYNDICATION_REGEX = /^syndication:[\s\S]*?(?=^\S|Z)/m;

export default class NostrSetup extends BaseCommand {
  static readonly summary = "Interactive Nostr setup wizard";

  async run(): Promise<void> {
    const { flags } = await this.parse(NostrSetup);
    const rootDir = this.getProjectDir(flags);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      this.log("=== Nostr Syndication Setup ===\n");

      const choice = await rl.question(
        "Generate a new Nostr identity (recommended) or import an existing nsec? [generate/import] "
      );

      let nsecHex: Uint8Array;
      let npub: string;

      if (choice.toLowerCase().startsWith("i")) {
        const nsecStr = await rl.question("Paste your nsec1... key: ");
        const { nip19 } = await import("nostr-tools");
        const decoded = nip19.decode(nsecStr.trim());
        if (decoded.type !== "nsec") {
          this.error("Invalid nsec key");
        }
        nsecHex = decoded.data as Uint8Array;
        // Re-encode as npub for display
        const { getPublicKey, nip19: nip19utils } = await import("nostr-tools");
        npub = nip19utils.npubEncode(getPublicKey(nsecHex));
      } else {
        nsecHex = generateSecretKey();
        const { getPublicKey, nip19 } = await import("nostr-tools");
        npub = nip19.npubEncode(getPublicKey(nsecHex));
        this.log(`\nGenerated new Nostr identity: ${npub}`);
        this.log(
          "⚠️  WARNING: Store this npub in your password manager. If you lose the encrypted nsec AND your jwtSecret, this identity is unrecoverable."
        );
      }

      // Confirm the relays
      const relayInput = await rl.question(
        "\nEnter Nostr relay URLs (comma-separated, e.g., wss://relay.damus.io,wss://nos.lol): "
      );
      const relays = relayInput
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      if (relays.length === 0) {
        this.error("At least one relay is required");
      }

      // Get profile info
      const name =
        (await rl.question("Profile name (optional): ")).trim() || undefined;
      const about =
        (await rl.question("Profile about (optional): ")).trim() || undefined;

      // We need to update config.yml with the encrypted nsec
      // Read the existing config
      const configPath = `${rootDir}/${DEFAULT_CONFIG_PATH}`;
      const fs = await import("node:fs");
      let configYaml = fs.existsSync(configPath)
        ? fs.readFileSync(configPath, "utf-8")
        : "";

      // Get the jwtSecret from config
      const config = getConfig(rootDir, {});
      const jwtSecret = config.jwtSecret;
      if (!jwtSecret) {
        this.error(
          "jwtSecret must be set (via HYPERNEXT_JWT_SECRET env var or config.yml) to encrypt the nsec"
        );
      }

      // Encrypt the nsec
      const encryptedNsec = encryptNsec(nsecHex, jwtSecret);

      // Build the nostr config block
      const nostrBlock = `
# Nostr syndication (set up via hypernext nostr setup)
syndication:
  nostr:
    enabled: true
    relays:${relays.map((r) => `\n      - "${r}"`).join("")}
    signer:
      type: nsec
      encryptedNsec: "${encryptedNsec}"
    profile:${name ? `\n      name: "${name}"` : ""}${about ? `\n      about: "${about}"` : ""}
    publishProfileOnStart: false
    announceOnFirstPublish: false
    subscribeReplies: false
`;

      // Append or replace the syndication block in config
      if (SYNDICATION_REGEX.test(configYaml)) {
        configYaml = configYaml.replace(SYNDICATION_REGEX, nostrBlock.trim());
      } else {
        configYaml += `\n${nostrBlock}`;
      }

      fs.writeFileSync(configPath, configYaml);

      this.log("\n✅ Nostr syndication configured!");
      this.log(`   Identity: ${npub}`);
      this.log(`   Relays: ${relays.length}`);
      this.log(
        "   The nsec is encrypted at rest with AES-256-GCM (key derived from jwtSecret)."
      );
      this.log(
        `\nTo syndicate a post, add "nostr: true" to its frontmatter and run:`
      );
      this.log("   hypernext nostr publish <slug>");
    } finally {
      rl.close();
    }
  }
}
