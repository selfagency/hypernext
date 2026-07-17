import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getOAuthToken, storeOAuthToken } from "../database/index.js";
import type { HypernextConfig } from "../types/config.js";

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function registerIndieAuthRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  // /.well-known/oauth-authorization-server
  fastify.get("/.well-known/oauth-authorization-server", (_request, reply) => {
    reply.send({
      issuer: config.site.canonicalBase,
      authorization_endpoint: `${config.site.canonicalBase}/auth/authorize`,
      token_endpoint: `${config.site.canonicalBase}/auth/token`,
      revocation_endpoint: `${config.site.canonicalBase}/auth/revoke`,
      scopes_supported: ["create", "update", "delete", "media", "upload"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  // GET /auth/authorize — authorization endpoint
  fastify.get<{
    Querystring: {
      redirect_uri?: string;
      client_id?: string;
      state?: string;
      code_challenge?: string;
    };
  }>("/auth/authorize", async (request, reply) => {
    const { redirect_uri, client_id, state } = request.query;

    if (!(redirect_uri && client_id)) {
      reply.code(400).send({ error: "Missing redirect_uri or client_id" });
      return;
    }

    const code = generateToken();
    await storeOAuthToken({
      provider: "indieauth",
      token: code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    reply.code(302).header("Location", redirectUrl.toString()).send();
  });

  // POST /auth/token — token endpoint
  fastify.post<{
    Body: {
      grant_type?: string;
      code?: string;
      redirect_uri?: string;
      client_id?: string;
      code_verifier?: string;
    };
  }>("/auth/token", async (request, reply) => {
    const { grant_type, code } = request.body;

    if (grant_type !== "authorization_code" || !code) {
      reply.code(400).send({ error: "Invalid grant_type or missing code" });
      return;
    }

    const stored = await getOAuthToken("indieauth");
    if (!stored || stored.token !== code) {
      reply.code(400).send({ error: "Invalid authorization code" });
      return;
    }

    const accessToken = generateToken();
    const refreshToken = generateToken();

    await storeOAuthToken({
      provider: "indieauth",
      token: accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    reply.send({
      access_token: accessToken,
      token_type: "Bearer",
      scope: "create update delete media upload",
      me: config.site.canonicalBase,
      refresh_token: refreshToken,
    });
  });

  // POST /auth/revoke — token revocation
  fastify.post<{ Body: { token?: string } }>(
    "/auth/revoke",
    (_request, reply) => {
      reply.send({});
    }
  );
}
