import fjwt from "@fastify/jwt";
import { Flags } from "@oclif/core";
import Fastify from "fastify";
import { getConfig } from "../config.js";
import BaseCommand from "../lib/base-command.js";
import type { CliOptions } from "../types/config.js";

export default class Token extends BaseCommand {
  static summary = "Generate an API access token";
  static description =
    "Generate a long-lived JWT access token for API authentication. The token is valid for 1 year and grants full API access (create, update, delete, media, upload).";

  static flags = {
    ...BaseCommand.flags,
    name: Flags.string({
      summary: "Token name/description",
      default: "cli-token",
    }),
    expires: Flags.integer({
      summary: "Token expiry in days",
      default: 365,
    }),
    scope: Flags.string({
      summary: "Comma-separated scopes",
      default: "create,update,delete,media,upload",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Token);
    const rootDir = this.getProjectDir(flags);
    const config = getConfig(rootDir, {} as CliOptions);

    if (config.indieauth?.enabled === false) {
      this.error(
        "IndieAuth is not enabled. Set indieauth.enabled: true in config.yml"
      );
    }

    // Create a minimal Fastify instance just to sign the JWT
    const fastify = Fastify({ logger: false });
    await fastify.register(fjwt, {
      secret: config.jwtSecret || "hypernext-dev-secret",
    });
    await fastify.ready();

    const token = await fastify.jwt.sign(
      {
        sub: config.site.canonicalBase,
        scope: flags.scope,
        name: flags.name,
      },
      { expiresIn: `${flags.expires}d` }
    );

    await fastify.close();

    this.log(`\nToken: ${token}\n`);
    this.log(`Name: ${flags.name}`);
    this.log(`Scopes: ${flags.scope}`);
    this.log(`Expires: ${flags.expires} days`);
    this.log("\nAdd this token to your remote config.yml:");
    this.log("  remote:");
    this.log("    enabled: true");
    this.log(`    url: "${config.site.canonicalBase}"`);
    this.log(`    token: "${token}"`);
    this.log("\nOr use it directly in API calls:");
    this.log(
      `  curl -H "Authorization: Bearer ${token}" ${config.site.canonicalBase}/api/v1/docs`
    );
  }
}
