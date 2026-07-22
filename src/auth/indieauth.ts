import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { HypernextConfig } from "../types/config.js";

const PLUS_RE = /\+/g;
const SLASH_RE = /\//g;
const EQUALS_RE = /=+$/;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(PLUS_RE, "-")
    .replace(SLASH_RE, "_")
    .replace(EQUALS_RE, "");
}

function hashPkceChallenge(verifier: string): string {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
}

function getOrigin(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

// ── In-memory authorization code store (ephemeral, 10-min TTL) ──

interface AuthCodeRecord {
  clientId: string;
  code: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  createdAt: number;
  redirectUri: string;
}

const authCodes = new Map<string, AuthCodeRecord>();

// Expire old codes every 60s
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [code, record] of authCodes) {
    if (record.createdAt < cutoff) {
      authCodes.delete(code);
    }
  }
}, 60_000).unref();

export function registerIndieAuthRoutes(
  fastify: FastifyInstance,
  config: HypernextConfig
): void {
  if (config.indieauth?.enabled === false) {
    return;
  }

  // ── Authorization Server Metadata ──
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
      code_challenge_method?: string;
    };
  }>("/auth/authorize", (request, reply) => {
    const {
      redirect_uri,
      client_id,
      state,
      code_challenge,
      code_challenge_method,
    } = request.query;

    if (!redirect_uri) {
      reply.code(400).send({ error: "Missing redirect_uri" });
      return;
    }
    if (!client_id) {
      reply.code(400).send({ error: "Missing client_id" });
      return;
    }

    // Validate redirect_uri is same-origin with client_id
    const redirectOrigin = getOrigin(redirect_uri);
    const clientOrigin = getOrigin(client_id);
    if (redirectOrigin !== clientOrigin) {
      reply
        .code(400)
        .send({ error: "redirect_uri must be same-origin as client_id" });
      return;
    }

    // Validate PKCE code_challenge if provided
    if (code_challenge && code_challenge_method !== "S256") {
      reply
        .code(400)
        .send({ error: "Only S256 code_challenge_method is supported" });
      return;
    }

    const code = generateToken();
    const record: AuthCodeRecord = {
      code,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge ?? "",
      codeChallengeMethod: code_challenge_method ?? "",
      createdAt: Date.now(),
    };
    authCodes.set(code, record);

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
    const { grant_type, code, redirect_uri, client_id, code_verifier } =
      request.body;

    if (grant_type !== "authorization_code" || !code) {
      reply.code(400).send({ error: "Invalid grant_type or missing code" });
      return;
    }

    // Look up the authorization code record
    const record = authCodes.get(code);
    if (!record) {
      reply.code(400).send({ error: "Invalid or expired authorization code" });
      return;
    }

    // Consume the code (single-use)
    authCodes.delete(code);

    // Validate client_id matches the original authorization request
    if (client_id && client_id !== record.clientId) {
      reply.code(400).send({ error: "client_id mismatch" });
      return;
    }

    // Validate redirect_uri matches the original authorization request
    if (redirect_uri && redirect_uri !== record.redirectUri) {
      reply.code(400).send({ error: "redirect_uri mismatch" });
      return;
    }

    // Validate PKCE code_verifier against stored code_challenge
    if (record.codeChallenge) {
      if (!code_verifier) {
        reply
          .code(400)
          .send({ error: "PKCE code_verifier is required for this code" });
        return;
      }
      const expectedChallenge = hashPkceChallenge(code_verifier);
      if (expectedChallenge !== record.codeChallenge) {
        reply.code(400).send({ error: "PKCE verification failed" });
        return;
      }
    }

    // Sign a JWT access token
    const accessToken = await reply.jwtSign(
      {
        sub: config.site.canonicalBase,
        scope: "create update delete media upload",
      },
      { expiresIn: "1h" }
    );

    const refreshToken = generateToken();

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
