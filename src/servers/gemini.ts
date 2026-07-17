import fs from "node:fs";
import tls from "node:tls";
import { recordPageview } from "../analytics/stats-manager.js";
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
const BOM_REGEX = /^\uFEFF/;

export function startGeminiServer(config: HypernextConfig): tls.Server {
  const { port, certPath, keyPath } = config.protocols.gemini;
  if (!(certPath && keyPath)) {
    throw new Error("Gemini server requires certPath and keyPath in config");
  }

  const server = tls.createServer(
    {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    },
    (socket) => {
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString("utf-8");
        if (data.includes("\r\n") || data.length > 1024) {
          handleRequest(socket, data.trim(), config);
        }
      });
    }
  );

  server.listen(port, () => {
    console.log(`Gemini server listening on port ${port}`);
  });
  return server;
}

async function handleRequest(
  socket: tls.TLSSocket,
  request: string,
  config: HypernextConfig
): Promise<void> {
  // Strip BOM if present
  const cleaned = request.replace(BOM_REGEX, "");
  const url = cleaned.trim();

  if (!url) {
    socket.end("59 Bad Request\r\n");
    return;
  }

  const pathname = new URL(url).pathname;
  const slug = pathname.replace(LEADING_SLASH_REGEX, "");

  if (!slug) {
    const home = `# ${config.site.meta.title}\n\n${config.site.meta.description}`;
    socket.end(`20 text/gemini\r\n${home}`);
    return;
  }

  const cached = getCachedParse(slug);
  if (cached) {
    if (
      isDocPrivateFrontmatter(cached.frontmatter) ||
      isFutureDatedFrontmatter(cached.frontmatter)
    ) {
      socket.end("51 Not Found\r\n");
      return;
    }
    socket.end(`20 text/gemini\r\n${renderGemtext(cached.ir)}`);
    return;
  }

  const doc = await getDocBySlug(slug);
  if (!doc) {
    socket.end("51 Not Found\r\n");
    return;
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  if (isDocPrivate(rawMdx) || isFutureDated(rawMdx)) {
    socket.end("51 Not Found\r\n");
    return;
  }

  const result = parseToIR(rawMdx, slug);
  await resolveComponentNodes(result.ir, config, slug);
  setCachedParse(slug, result);
  socket.end(`20 text/gemini\r\n${renderGemtext(result.ir)}`);

  // Fire-and-forget pageview recording
  recordPageview(slug, "gemini", socket.remoteAddress ?? "0.0.0.0").catch(
    () => {
      /* fire-and-forget */
    }
  );
}
