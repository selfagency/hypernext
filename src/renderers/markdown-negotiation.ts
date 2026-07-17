import type { FastifyReply, FastifyRequest } from "fastify";
import { getCachedParse } from "../cache.js";
import { parseToIR } from "../parser/pipeline.js";
import type { HypernextConfig } from "../types/config.js";
import { renderMarkdown } from "./markdown.js";

export function handleMarkdownNegotiation(
  request: FastifyRequest,
  reply: FastifyReply,
  config: HypernextConfig,
  slug: string,
  rawMdx: string
): boolean {
  if (!(config.agent?.enabled && config.agent.markdownNegotiation)) {
    return false;
  }

  const accept = request.headers.accept as string | undefined;
  if (!accept?.includes("text/markdown")) {
    return false;
  }

  const result = getCachedParse(slug) ?? parseToIR(rawMdx, slug);
  const markdown = renderMarkdown(result.ir);
  const originalTokens = Math.ceil(rawMdx.length / 4);
  const markdownTokens = Math.ceil(markdown.length / 4);

  reply
    .type("text/markdown; charset=utf-8")
    .header("Vary", "Accept")
    .header("x-markdown-tokens", String(markdownTokens))
    .header("x-original-tokens", String(originalTokens))
    .send(markdown);

  return true;
}
