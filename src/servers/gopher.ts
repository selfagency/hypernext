import net from "node:net";
import { getDocBySlug, listDocSlugs } from "../database/index.js";
import { isDocPrivate } from "../parser/frontmatter.js";
import { parseToIR, resolveComponentNodes } from "../parser/pipeline.js";
import { renderGemtext } from "../renderers/gemtext.js";
import type { HypernextConfig } from "../types/config.js";

const LEADING_SLASH_REGEX = /^\//;

export function startGopherServer(config: HypernextConfig): net.Server {
  const { port } = config.protocols.gopher;

  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf-8");
      if (data.includes("\r\n") || data.length > 256) {
        handleGopherRequest(socket, data.trim(), config);
      }
    });
  });

  server.listen(port, () => {
    console.log(`Gopher server listening on port ${port}`);
  });
  return server;
}

async function handleGopherRequest(
  socket: net.Socket,
  selector: string,
  config: HypernextConfig
): Promise<void> {
  const cleaned = selector.replace(LEADING_SLASH_REGEX, "").trim();

  if (!cleaned) {
    // Root menu — exclude private docs
    const slugs = await listDocSlugs();
    const visibleSlugs: string[] = [];
    for (const slug of slugs) {
      const doc = await getDocBySlug(slug);
      if (doc && !isDocPrivate((doc.rawMdx as string) ?? "")) {
        visibleSlugs.push(slug);
      }
    }

    const menu = visibleSlugs
      .map((slug) => `0${slug}\t/${slug}\t${config.site.canonicalBase}\t1`)
      .join("\r\n");
    socket.end(`${menu}\r\n.\r\n`);
    return;
  }

  const doc = await getDocBySlug(cleaned);
  if (!doc) {
    socket.end("3\tNot Found\terror.host\t1\r\n.\r\n");
    return;
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  if (isDocPrivate(rawMdx)) {
    socket.end("3\tNot Found\terror.host\t1\r\n.\r\n");
    return;
  }

  const result = parseToIR(rawMdx, cleaned);
  await resolveComponentNodes(result.ir, config, cleaned);

  const text = renderGemtext(result.ir);
  socket.end(`${text}\r\n.\r\n`);
}
