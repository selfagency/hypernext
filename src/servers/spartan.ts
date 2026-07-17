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
import { renderGemtext } from "../renderers/gemtext.js";
import type { HypernextConfig } from "../types/config.js";

const LEADING_SLASH_REGEX = /^\//;

export function startSpartanServer(config: HypernextConfig): net.Server {
  const { port } = config.protocols.spartan;

  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf-8");
      if (data.includes("\r\n") || data.length > 1024) {
        handleSpartanRequest(socket, data.trim(), config);
      }
    });
  });

  server.listen(port, () => {
    console.log(`Spartan server listening on port ${port}`);
  });
  return server;
}

async function handleSpartanRequest(
  socket: net.Socket,
  request: string,
  config: HypernextConfig
): Promise<void> {
  // Spartan format: host path content-length\r\n
  const parts = request.split(" ");
  const pathname = parts[1] ?? "/";
  const slug = pathname.replace(LEADING_SLASH_REGEX, "");

  if (!slug) {
    const home = `# ${config.site.meta.title}\n\n${config.site.meta.description}`;
    socket.end(`200 text/gemini\r\n${home}`);
    return;
  }

  const cached = getCachedParse(slug);
  if (cached) {
    if (
      isDocPrivateFrontmatter(cached.frontmatter) ||
      isFutureDatedFrontmatter(cached.frontmatter)
    ) {
      socket.end("510 Not Found\r\n");
      return;
    }
    socket.end(`200 text/gemini\r\n${renderGemtext(cached.ir)}`);
    return;
  }

  const doc = await getDocBySlug(slug);
  if (!doc) {
    socket.end("510 Not Found\r\n");
    return;
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  if (isDocPrivate(rawMdx) || isFutureDated(rawMdx)) {
    socket.end("510 Not Found\r\n");
    return;
  }

  const result = parseToIR(rawMdx, slug);
  await resolveComponentNodes(result.ir, config, slug);
  setCachedParse(slug, result);
  socket.end(`200 text/gemini\r\n${renderGemtext(result.ir)}`);
}
