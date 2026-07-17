import net from "node:net";
import { getCachedParse, setCachedParse } from "../cache.js";
import { getDocBySlug } from "../database/index.js";
import { isDocPrivate } from "../parser/frontmatter.js";
import { parseToIR, resolveComponentNodes } from "../parser/pipeline.js";
import { renderGemtext } from "../renderers/gemtext.js";
import type { HypernextConfig } from "../types/config.js";

const LEADING_SLASH_REGEX = /^\//;

export function startNexServer(config: HypernextConfig): net.Server {
  const { port } = config.protocols.nex;

  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf-8");
      if (data.includes("\n") || data.length > 0) {
        handleNexRequest(socket, data.trim(), config);
      }
    });
  });

  server.listen(port, () => {
    console.log(`NEX server listening on port ${port}`);
  });
  return server;
}

async function handleNexRequest(
  socket: net.Socket,
  request: string,
  config: HypernextConfig
): Promise<void> {
  const slug = request.replace(LEADING_SLASH_REGEX, "").trim();

  if (!slug) {
    socket.end(
      `# ${config.site.meta.title}\n\n${config.site.meta.description}`
    );
    return;
  }

  const cached = getCachedParse(slug);
  if (cached) {
    socket.end(renderGemtext(cached.ir));
    return;
  }

  const doc = await getDocBySlug(slug);
  if (!doc) {
    socket.end("Not Found");
    return;
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  if (isDocPrivate(rawMdx)) {
    socket.end("Not Found");
    return;
  }

  const result = parseToIR(rawMdx, slug);
  await resolveComponentNodes(result.ir, config, slug);
  setCachedParse(slug, result);
  socket.end(renderGemtext(result.ir));
}
