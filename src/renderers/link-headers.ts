import type { FastifyReply } from "fastify";
import type { HypernextConfig } from "../types/config.js";

const TRAILING_SLASH_REGEX = /\/+$/;

export function addLinkHeaders(
  reply: FastifyReply,
  config: HypernextConfig,
  slug?: string
): void {
  if (!(config.agent?.enabled && config.agent.linkHeaders)) {
    return;
  }

  const base = config.site.canonicalBase.replace(TRAILING_SLASH_REGEX, "");
  const links: string[] = [];

  // API catalog
  links.push(`<${base}/.well-known/api-catalog>; rel="api-catalog"`);

  // Service endpoint
  links.push(`<${base}/api/v1/docs>; rel="service"`);

  // Markdown variant
  if (config.agent.markdownNegotiation) {
    links.push(
      `<${base}${slug ? `/${slug}` : ""}/index.md>; rel="alternate"; type="text/markdown"`
    );
  }

  // Canonical
  if (slug) {
    links.push(`<${base}/${slug}>; rel="canonical"`);
  }

  // MCP
  if (config.agent.wellKnown.webmcp) {
    links.push(`<${base}/.well-known/mcp.json>; rel="mcp"`);
  }

  if (links.length > 0) {
    reply.header("Link", links.join(", "));
  }
}
