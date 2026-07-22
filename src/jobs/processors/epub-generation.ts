import fs from "node:fs";
import path from "node:path";
import { parseToIR } from "../../parser/pipeline.js";

export async function processEpubGeneration(
  payload: Record<string, unknown>
): Promise<void> {
  const { initOrm } = await import("../../database/index.js");
  const config = payload.__config as Record<string, unknown> | undefined;
  if (config) {
    await initOrm((config.database as Record<string, unknown>).path as string);
  }

  const collectionName = payload.collectionName as string;
  const slugs = payload.slugs as string[];

  const chapters: { title: string; data: string }[] = [];
  for (const slug of slugs) {
    const { getDocBySlug } = await import("../../database/index.js");
    const doc = await getDocBySlug(slug);
    if (!doc) {
      continue;
    }
    const rawMdx = (doc.rawMdx as string) ?? "";
    const result = parseToIR(rawMdx, slug);
    const { renderHTML } = await import("../../renderers/html.js");
    const html = renderHTML(result, config as never, slug, {
      contentCid: (doc.contentCid as string | undefined) ?? undefined,
      htmlCid: (doc.htmlCid as string | undefined) ?? undefined,
    });
    chapters.push({ title: (doc.title as string) ?? slug, data: html });
  }

  try {
    const { EPub } = await import("@lesjoursfr/html-to-epub");
    const tmpPath = path.join(
      fs.realpathSync("."),
      `tmp-epub-${collectionName}-${Date.now()}.epub`
    );
    const epub = new (
      EPub as unknown as new (
        options: Record<string, unknown>,
        output: string
      ) => { render: () => Promise<{ result: string }> }
    )(
      {
        title: collectionName,
        content: chapters,
        author: (config?.author as Record<string, unknown> | undefined)?.name,
        lang: (
          (config?.site as Record<string, unknown> | undefined)?.meta as
            | Record<string, unknown>
            | undefined
        )?.lang,
        cover: (
          (config?.site as Record<string, unknown> | undefined)?.ebooks as
            | Record<string, unknown>
            | undefined
        )?.coverImage
          ? path.resolve(
              (
                (config?.site as Record<string, unknown> | undefined)?.ebooks as
                  | Record<string, unknown>
                  | undefined
              )?.coverImage as string
            )
          : undefined,
      },
      tmpPath
    );
    await epub.render();
    const content = fs.readFileSync(tmpPath, "utf-8");
    fs.rmSync(tmpPath, { force: true });
    const { writeStorage } = await import("../../storage/index.js");
    await writeStorage(`${collectionName}.epub`, content);
  } catch (error) {
    console.error(`EPUB generation failed for ${collectionName}:`, error);
  }
}
