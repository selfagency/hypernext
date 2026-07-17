import net from "node:net";
import { getCachedParse, setCachedParse } from "../cache.js";
import { getDocBySlug } from "../database/index.js";
import {
  isDocPrivate,
  isDocPrivateFrontmatter,
  isFutureDated,
  isFutureDatedFrontmatter,
} from "../parser/frontmatter.js";
import { parseToIR, resolveComponentNodes } from "../parser/pipeline.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { HypernextConfig } from "../types/config.js";

const LEADING_SLASH_REGEX = /^\//;

export function startTextServer(config: HypernextConfig): net.Server {
  const { port } = config.protocols.text;

  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf-8");
      if (data.includes("\n") || data.length > 256) {
        handleTextRequest(socket, data.trim(), config);
      }
    });
  });

  server.listen(port, () => {
    console.log(`Text server listening on port ${port}`);
  });
  return server;
}

async function handleTextRequest(
  socket: net.Socket,
  request: string,
  config: HypernextConfig
): Promise<void> {
  const slug = request.replace(LEADING_SLASH_REGEX, "").trim();

  if (!slug) {
    const home = `# ${config.site.meta.title}\n\n${config.site.meta.description}`;
    socket.end(`20 OK\n${home}\n`);
    return;
  }

  const cached = getCachedParse(slug);
  if (cached) {
    if (
      isDocPrivateFrontmatter(cached.frontmatter) ||
      isFutureDatedFrontmatter(cached.frontmatter)
    ) {
      socket.end("40 Not Found\n");
      return;
    }
    socket.end(`20 OK\n${renderMarkdown(cached.ir)}\n`);
    return;
  }

  const doc = await getDocBySlug(slug);
  if (!doc) {
    socket.end("40 Not Found\n");
    return;
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  if (isDocPrivate(rawMdx) || isFutureDated(rawMdx)) {
    socket.end("40 Not Found\n");
    return;
  }

  const result = parseToIR(rawMdx, slug);
  await resolveComponentNodes(result.ir, config, slug);
  setCachedParse(slug, result);
  socket.end(`20 OK\n${renderMarkdown(result.ir)}\n`);
}
